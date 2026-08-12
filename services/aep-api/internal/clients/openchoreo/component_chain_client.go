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

package openchoreo

import (
	"context"
	"fmt"
	"net/http"

	ocgen "github.com/wso2/aep/aep-api/internal/clients/openchoreo/gen"
)

// EnsureWorkload creates the component's Workload — the per-cycle image and env.
// 409 Conflict is success: a resumed dispatch re-posts the same deterministic
// name, and the Workload it would create is byte-identical.
func (c *componentClient) EnsureWorkload(ctx context.Context, orgName, projectName string, in WorkloadInput) error {
	scoped := ScopedComponentName(projectName, in.ComponentName)
	meta := ocgen.ObjectMeta{Name: scoped}
	if len(in.Labels) > 0 {
		labels := make(map[string]string, len(in.Labels))
		for k, v := range in.Labels {
			labels[k] = v
		}
		meta.Labels = &labels
	}
	body := ocgen.Workload{
		Metadata: meta,
		Spec: &ocgen.WorkloadSpec{
			Owner: &struct {
				ComponentName string `json:"componentName"`
				ProjectName   string `json:"projectName"`
			}{ComponentName: scoped, ProjectName: projectName},
			Container: &ocgen.WorkloadContainer{
				Image: in.Image,
				Env:   workflowEnvVarRefsToGen(in.Env),
			},
		},
	}

	resp, err := c.oc.CreateWorkloadWithResponse(ctx, orgName, ocgen.CreateWorkloadJSONRequestBody(body))
	if err != nil {
		return fmt.Errorf("failed to create workload %q: %w", scoped, err)
	}
	switch resp.StatusCode() {
	case http.StatusCreated, http.StatusOK, http.StatusConflict:
		return nil
	}
	return fmt.Errorf("create workload %q: %w", scoped,
		handleErrorResponse(resp.StatusCode(), ErrorResponses{
			JSON400: resp.JSON400,
			JSON401: resp.JSON401,
			JSON403: resp.JSON403,
			JSON409: resp.JSON409,
			JSON500: resp.JSON500,
		}))
}

func (c *componentClient) setReleaseBindingRelease(ctx context.Context, orgName, bindingName, releaseName string) error {
	return retryStaleWrite(ctx, "releasebinding/"+bindingName+" spec.releaseName", func(ctx context.Context) error {
		getResp, err := c.oc.GetReleaseBindingWithResponse(ctx, orgName, ocgen.ReleaseBindingNameParam(bindingName))
		if err != nil {
			return fmt.Errorf("get release binding %q: %w", bindingName, err)
		}
		if getResp.StatusCode() != http.StatusOK || getResp.JSON200 == nil {
			return handleErrorResponse(getResp.StatusCode(), ErrorResponses{
				JSON401: getResp.JSON401, JSON403: getResp.JSON403, JSON404: getResp.JSON404, JSON500: getResp.JSON500,
			})
		}
		rb := *getResp.JSON200
		if rb.Spec == nil {
			rb.Spec = &ocgen.ReleaseBindingSpec{}
		}
		rb.Spec.ReleaseName = &releaseName
		updateResp, updateErr := c.oc.UpdateReleaseBindingWithResponse(ctx, orgName, ocgen.ReleaseBindingNameParam(bindingName), ocgen.UpdateReleaseBindingJSONRequestBody(rb))
		if updateErr != nil {
			return fmt.Errorf("update release binding %q release: %w", bindingName, updateErr)
		}
		if updateResp.StatusCode() != http.StatusOK && updateResp.StatusCode() != http.StatusCreated {
			return handleErrorResponse(updateResp.StatusCode(), ErrorResponses{
				JSON400: updateResp.JSON400, JSON401: updateResp.JSON401, JSON403: updateResp.JSON403,
				JSON404: updateResp.JSON404, JSON500: updateResp.JSON500,
			})
		}
		return nil
	})
}

// EnsureRelease cuts the component's ComponentRelease under the CALLER'S name
// and returns it. The name is supplied rather than server-generated so a
// resumed dispatch rebinds the same release instead of cutting a second one.
//
// 409 Conflict means the release is already there — return the same name.
func (c *componentClient) EnsureRelease(ctx context.Context, orgName, projectName, componentName, releaseName string) (string, error) {
	scoped := ScopedComponentName(projectName, componentName)
	name := releaseName
	resp, err := c.oc.GenerateReleaseWithResponse(ctx, orgName, ocgen.ComponentNameParam(scoped),
		ocgen.GenerateReleaseJSONRequestBody{ReleaseName: &name})
	if err != nil {
		return "", fmt.Errorf("failed to generate release for %q: %w", scoped, err)
	}
	switch resp.StatusCode() {
	case http.StatusCreated, http.StatusOK, http.StatusConflict:
		return releaseName, nil
	}
	return "", fmt.Errorf("generate release for %q: %w", scoped,
		handleErrorResponse(resp.StatusCode(), ErrorResponses{
			JSON400: resp.JSON400,
			JSON401: resp.JSON401,
			JSON403: resp.JSON403,
			JSON404: resp.JSON404,
			JSON500: resp.JSON500,
		}))
}

// GenerateRelease asks OpenChoreo to snapshot the component's current state
// under a controller-generated name. User-component deploys use this when
// auto-deploy is disabled and no release exists yet.
func (c *componentClient) GenerateRelease(ctx context.Context, orgName, projectName, componentName string) (string, error) {
	scoped := ScopedComponentName(projectName, componentName)
	resp, err := c.oc.GenerateReleaseWithResponse(ctx, orgName, ocgen.ComponentNameParam(scoped), ocgen.GenerateReleaseJSONRequestBody{})
	if err != nil {
		return "", fmt.Errorf("failed to generate release for %q: %w", scoped, err)
	}
	if resp.StatusCode() == http.StatusCreated && resp.JSON201 != nil {
		return resp.JSON201.Metadata.Name, nil
	}
	return "", fmt.Errorf("generate release for %q: %w", scoped,
		handleErrorResponse(resp.StatusCode(), ErrorResponses{
			JSON400: resp.JSON400, JSON401: resp.JSON401, JSON403: resp.JSON403,
			JSON404: resp.JSON404, JSON500: resp.JSON500,
		}))
}

// LatestComponentRelease reads the controller's newest release pointer. Empty
// means no release has been cut for the component yet.
func (c *componentClient) LatestComponentRelease(ctx context.Context, orgName, projectName, componentName string) (string, error) {
	scoped := ScopedComponentName(projectName, componentName)
	resp, err := c.oc.GetComponentWithResponse(ctx, orgName, ocgen.ComponentNameParam(scoped))
	if err != nil {
		return "", fmt.Errorf("get component %q latest release: %w", scoped, err)
	}
	if resp.StatusCode() != http.StatusOK || resp.JSON200 == nil {
		return "", handleErrorResponse(resp.StatusCode(), ErrorResponses{
			JSON401: resp.JSON401, JSON403: resp.JSON403, JSON404: resp.JSON404, JSON500: resp.JSON500,
		})
	}
	if resp.JSON200.Status == nil || resp.JSON200.Status.LatestRelease == nil || resp.JSON200.Status.LatestRelease.Name == nil {
		return "", nil
	}
	return *resp.JSON200.Status.LatestRelease.Name, nil
}

// EnsureReleaseBinding binds the release into an environment — the last link
// that makes OC render the Job into the project's dataplane namespace.
// 409 Conflict is success (same resumability rule as EnsureWorkload).
func (c *componentClient) EnsureReleaseBinding(ctx context.Context, orgName, projectName, componentName, environment, releaseName string) error {
	scoped := ScopedComponentName(projectName, componentName)
	bindingName := scoped + "-" + environment
	release := releaseName
	body := ocgen.ReleaseBinding{
		Metadata: ocgen.ObjectMeta{Name: bindingName},
		Spec: &ocgen.ReleaseBindingSpec{
			Environment: environment,
			Owner: struct {
				ComponentName string `json:"componentName"`
				ProjectName   string `json:"projectName"`
			}{ComponentName: scoped, ProjectName: projectName},
			ReleaseName: &release,
		},
	}

	resp, err := c.oc.CreateReleaseBindingWithResponse(ctx, orgName, ocgen.CreateReleaseBindingJSONRequestBody(body))
	if err != nil {
		return fmt.Errorf("failed to create release binding %q: %w", bindingName, err)
	}
	switch resp.StatusCode() {
	case http.StatusCreated, http.StatusOK:
		return nil
	case http.StatusConflict:
		// The binding already exists, so ensuring it means re-pinning it to the
		// requested newest release rather than accepting a stale pin.
		return c.setReleaseBindingRelease(ctx, orgName, bindingName, releaseName)
	}
	return fmt.Errorf("create release binding %q: %w", bindingName,
		handleErrorResponse(resp.StatusCode(), ErrorResponses{
			JSON400: resp.JSON400,
			JSON401: resp.JSON401,
			JSON403: resp.JSON403,
			JSON409: resp.JSON409,
			JSON500: resp.JSON500,
		}))
}

// SetReleaseBindingState updates only the binding state and preserves every
// controller- and feature-owned sibling field. The GET lives inside the stale
// write closure so a retry always reapplies Active to a fresh object.
func (c *componentClient) SetReleaseBindingState(ctx context.Context, orgName, projectName, componentName, environment, state string) error {
	bindingName := ScopedComponentName(projectName, componentName) + "-" + environment
	return retryStaleWrite(ctx, "releasebinding/"+bindingName+" spec.state", func(ctx context.Context) error {
		getResp, err := c.oc.GetReleaseBindingWithResponse(ctx, orgName, ocgen.ReleaseBindingNameParam(bindingName))
		if err != nil {
			return fmt.Errorf("get release binding %q: %w", bindingName, err)
		}
		if getResp.StatusCode() != http.StatusOK || getResp.JSON200 == nil {
			return handleErrorResponse(getResp.StatusCode(), ErrorResponses{
				JSON401: getResp.JSON401, JSON403: getResp.JSON403, JSON404: getResp.JSON404, JSON500: getResp.JSON500,
			})
		}
		rb := *getResp.JSON200
		if rb.Spec == nil {
			rb.Spec = &ocgen.ReleaseBindingSpec{}
		}
		bindingState := ocgen.ReleaseBindingSpecState(state)
		rb.Spec.State = &bindingState
		updateResp, updateErr := c.oc.UpdateReleaseBindingWithResponse(ctx, orgName, ocgen.ReleaseBindingNameParam(bindingName), ocgen.UpdateReleaseBindingJSONRequestBody(rb))
		if updateErr != nil {
			return fmt.Errorf("update release binding %q state: %w", bindingName, updateErr)
		}
		if updateResp.StatusCode() != http.StatusOK && updateResp.StatusCode() != http.StatusCreated {
			return handleErrorResponse(updateResp.StatusCode(), ErrorResponses{
				JSON400: updateResp.JSON400, JSON401: updateResp.JSON401, JSON403: updateResp.JSON403,
				JSON404: updateResp.JSON404, JSON500: updateResp.JSON500,
			})
		}
		return nil
	})
}
