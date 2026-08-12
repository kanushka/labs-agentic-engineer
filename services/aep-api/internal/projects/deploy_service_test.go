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
	"testing"

	"github.com/wso2/aep/aep-api/internal/gen"
)

type fakeDeployClient struct {
	components []gen.Component
	latest     map[string]string
	ensured    []string
	pinned     []string
	activated  []string
}

func (f *fakeDeployClient) ListComponents(context.Context, string, string, int, string) (*gen.ComponentList, error) {
	return &gen.ComponentList{Items: f.components}, nil
}
func (f *fakeDeployClient) LatestComponentRelease(_ context.Context, _, _, component string) (string, error) {
	return f.latest[component], nil
}
func (f *fakeDeployClient) EnsureRelease(_ context.Context, _, _, component, release string) (string, error) {
	f.ensured = append(f.ensured, component+":"+release)
	if f.latest == nil {
		f.latest = map[string]string{}
	}
	f.latest[component] = release
	return release, nil
}
func (f *fakeDeployClient) EnsureReleaseBinding(_ context.Context, _, _, component, environment, release string) error {
	f.pinned = append(f.pinned, component+":"+environment+":"+release)
	return nil
}
func (f *fakeDeployClient) SetReleaseBindingState(_ context.Context, _, _, component, environment, state string) error {
	f.activated = append(f.activated, component+":"+environment+":"+state)
	return nil
}

type fakeDeployObserver struct {
	calls []string
	err   error
}

func (f *fakeDeployObserver) OnComponentDeployed(_ context.Context, _, _, component string) error {
	f.calls = append(f.calls, component)
	return f.err
}

func TestDeploymentServicePinsNewestReleaseAndRunsEveryObserver(t *testing.T) {
	for failing := 0; failing < 3; failing++ {
		t.Run(fmt.Sprintf("best-effort-%d-fails", failing+1), func(t *testing.T) {
			client := &fakeDeployClient{
				components: []gen.Component{{Name: "api"}, {Name: "web"}},
				latest:     map[string]string{"api": "api-r9"},
			}
			observers := []*fakeDeployObserver{{}, {}, {}, {}}
			observers[failing].err = errors.New("temporary convergence failure")
			svc := NewDeploymentService(client,
				DeployObserver{Observer: observers[0]},
				DeployObserver{Observer: observers[1]},
				DeployObserver{Observer: observers[2]},
				DeployObserver{Observer: observers[3], Fatal: true},
			)

			if err := svc.DeployProject(context.Background(), "acme", "shop", "run-42"); err != nil {
				t.Fatalf("DeployProject: %v", err)
			}
			if len(client.ensured) != 2 {
				t.Fatalf("ensured = %v, want one stable release per component", client.ensured)
			}
			wantPins := []string{"api:development:" + client.latest["api"], "web:development:" + client.latest["web"]}
			if len(client.pinned) != len(wantPins) || client.pinned[0] != wantPins[0] || client.pinned[1] != wantPins[1] {
				t.Fatalf("pinned = %v", client.pinned)
			}
			if len(client.activated) != 2 {
				t.Fatalf("activated = %v, want both components", client.activated)
			}
			for i, observer := range observers {
				if len(observer.calls) != 2 {
					t.Fatalf("observer %d calls = %v, want both components", i+1, observer.calls)
				}
			}
		})
	}
}

func TestDeploymentServiceFatalObserverFailsAfterFanout(t *testing.T) {
	client := &fakeDeployClient{components: []gen.Component{{Name: "api"}}, latest: map[string]string{"api": "api-r9"}}
	fatal := &fakeDeployObserver{err: errors.New("trait sync failed")}
	stillRuns := &fakeDeployObserver{}
	svc := NewDeploymentService(client,
		DeployObserver{Observer: fatal, Fatal: true},
		DeployObserver{Observer: stillRuns},
	)

	if err := svc.DeployProject(context.Background(), "acme", "shop", "run-42"); err == nil {
		t.Fatal("fatal observer error was swallowed")
	}
	if len(stillRuns.calls) != 1 {
		t.Fatalf("later observer calls = %v, want one", stillRuns.calls)
	}
	if len(client.activated) != 0 {
		t.Fatalf("fatal observer left a binding Active: %v", client.activated)
	}
}
