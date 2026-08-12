// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package projects

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/k8sname"
)

type deploymentClient interface {
	ListComponents(ctx context.Context, orgName, projectName string, limit int, cursor string) (*gen.ComponentList, error)
	EnsureRelease(ctx context.Context, orgName, projectName, componentName, releaseName string) (string, error)
	LatestComponentRelease(ctx context.Context, orgName, projectName, componentName string) (string, error)
	EnsureReleaseBinding(ctx context.Context, orgName, projectName, componentName, environment, releaseName string) error
	SetReleaseBindingState(ctx context.Context, orgName, projectName, componentName, environment, state string) error
}

// ComponentDeployObserver runs after one component is pinned Active. The
// registration declares whether its failure makes deployment unsafe.
type ComponentDeployObserver interface {
	OnComponentDeployed(ctx context.Context, orgID, projectID, component string) error
}

type DeployObserver struct {
	Observer ComponentDeployObserver
	Fatal    bool
}

// DeploymentService is the projects package's deployment write authority.
// Its method is one idempotent retry unit: re-generating is avoided by the
// latest-release read, and re-pinning/re-activating an existing binding is safe.
type DeploymentService struct {
	client    deploymentClient
	observers []DeployObserver
}

func NewDeploymentService(client deploymentClient, observers ...DeployObserver) *DeploymentService {
	return &DeploymentService{client: client, observers: observers}
}

func (s *DeploymentService) DeployProject(ctx context.Context, orgID, projectID, runID string) error {
	if s == nil || s.client == nil {
		return fmt.Errorf("projects: deployment client not configured")
	}
	if runID == "" {
		return fmt.Errorf("projects: empty deployment run identity")
	}
	components, err := s.client.ListComponents(ctx, orgID, projectID, 0, "")
	if err != nil {
		return fmt.Errorf("projects: list deployable components: %w", err)
	}
	if components == nil {
		return nil
	}
	pinned := make([]string, 0, len(components.Items))
	for _, component := range components.Items {
		// One deterministic release per (run, component): a new milestone cuts
		// the current Workload, while an activity retry gets a 409-safe reuse.
		requested := k8sname.Bounded(k8sname.MaxLabelValueLen,
			k8sname.Whole(projectID), k8sname.Whole(component.Name), k8sname.Whole(runID), k8sname.Whole("release"))
		if _, err := s.client.EnsureRelease(ctx, orgID, projectID, component.Name, requested); err != nil {
			return fmt.Errorf("projects: ensure release for %q: %w", component.Name, err)
		}
		// Re-read after ensure. If another actor cut a newer release, pinning it
		// is convergent and cannot regress the component to this run's snapshot.
		release, readErr := s.client.LatestComponentRelease(ctx, orgID, projectID, component.Name)
		if readErr != nil {
			return fmt.Errorf("projects: latest release for %q: %w", component.Name, readErr)
		}
		if release == "" {
			return fmt.Errorf("projects: component %q has no release after ensure", component.Name)
		}
		if err := s.client.EnsureReleaseBinding(ctx, orgID, projectID, component.Name, openchoreo.DevEnvironmentName, release); err != nil {
			return fmt.Errorf("projects: pin %q release %q: %w", component.Name, release, err)
		}
		pinned = append(pinned, component.Name)
	}

	var fatalErrors []error
	for _, component := range pinned {
		// No secret-operator wait belongs here. An empty secret-store path
		// creates no Kubernetes Secret, so at deploy the real Secret either
		// exists or a pod referencing it retries until it does. The dangerous
		// stale-secret case cannot arise because no placeholder Secret exists.
		for _, registration := range s.observers {
			if registration.Observer == nil {
				continue
			}
			if observerErr := registration.Observer.OnComponentDeployed(ctx, orgID, projectID, component); observerErr != nil {
				if registration.Fatal {
					fatalErrors = append(fatalErrors, fmt.Errorf("component %q deploy observer: %w", component, observerErr))
				} else {
					slog.WarnContext(ctx, "projects: deploy observer failed (best-effort)",
						"org", orgID, "project", projectID, "component", component, "error", observerErr)
				}
			}
		}
	}
	if err := errors.Join(fatalErrors...); err != nil {
		// In particular, managed-API traits are fatal. Keep every binding
		// inactive until all fatal convergence completed so a protected API is
		// never briefly exposed between activation and the activity retry.
		return err
	}
	for _, component := range pinned {
		if err := s.client.SetReleaseBindingState(ctx, orgID, projectID, component, openchoreo.DevEnvironmentName, "Active"); err != nil {
			return fmt.Errorf("projects: activate %q: %w", component, err)
		}
	}
	return nil
}
