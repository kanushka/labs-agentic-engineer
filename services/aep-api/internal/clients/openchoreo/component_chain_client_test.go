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
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

const (
	chainTestOrg     = "wc-abc"
	chainTestProject = "widgets"
	chainTestComp    = "ca-run"
	chainTestImage   = "ghcr.io/wso2/aep/remote-worker:latest"
	chainTestRelease = "widgets-ca-run-release"
	chainTestEnv     = DevEnvironmentName
)

func newTestComponentClient(t *testing.T, srv *httptest.Server) ComponentClient {
	t.Helper()
	return NewComponentClient(Config{BaseURL: srv.URL})
}

func chainScopedName() string {
	return ScopedComponentName(chainTestProject, chainTestComp)
}

func sampleWorkloadInput() WorkloadInput {
	return WorkloadInput{
		ComponentName: chainTestComp,
		Image:         chainTestImage,
		Env:           []WorkflowEnvVarRef{{Key: "FOO", Value: "bar"}},
		Labels:        map[string]string{"aep.wso2.com/internal": "true"},
	}
}

// ---- EnsureWorkload ---------------------------------------------------------

func TestEnsureWorkload_Create(t *testing.T) {
	var gotPath, gotMethod string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		writeJSON(t, w, http.StatusCreated, map[string]any{
			"metadata": map[string]any{"name": chainScopedName()},
		})
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	if err := c.EnsureWorkload(context.Background(), chainTestOrg, chainTestProject, sampleWorkloadInput()); err != nil {
		t.Fatalf("EnsureWorkload: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/api/v1/namespaces/wc-abc/workloads" {
		t.Errorf("unexpected request: %s %s", gotMethod, gotPath)
	}
	meta, _ := gotBody["metadata"].(map[string]any)
	if meta["name"] != chainScopedName() {
		t.Errorf("unexpected workload name: %v", meta["name"])
	}
}

func TestEnsureWorkload_ConflictIsSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method %s", r.Method)
		}
		writeJSON(t, w, http.StatusConflict, map[string]string{"error": "already exists"})
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	if err := c.EnsureWorkload(context.Background(), chainTestOrg, chainTestProject, sampleWorkloadInput()); err != nil {
		t.Fatalf("EnsureWorkload on 409: %v", err)
	}
}

func TestEnsureWorkload_ServerErrorWrapsSentinel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusInternalServerError, map[string]string{"error": "boom"})
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	err := c.EnsureWorkload(context.Background(), chainTestOrg, chainTestProject, sampleWorkloadInput())
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrInternalServerError) {
		t.Errorf("expected ErrInternalServerError, got %v", err)
	}
}

// ---- EnsureRelease ----------------------------------------------------------

func TestEnsureRelease_Create(t *testing.T) {
	var gotPath, gotMethod string
	var gotBody map[string]any
	scoped := chainScopedName()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		writeJSON(t, w, http.StatusCreated, map[string]any{
			"metadata": map[string]any{"name": chainTestRelease},
		})
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	got, err := c.EnsureRelease(context.Background(), chainTestOrg, chainTestProject, chainTestComp, chainTestRelease)
	if err != nil {
		t.Fatalf("EnsureRelease: %v", err)
	}
	wantPath := "/api/v1/namespaces/wc-abc/components/" + scoped + "/generate-release"
	if gotMethod != http.MethodPost || gotPath != wantPath {
		t.Errorf("unexpected request: %s %s", gotMethod, gotPath)
	}
	if gotBody["releaseName"] != chainTestRelease {
		t.Errorf("unexpected releaseName: %v", gotBody["releaseName"])
	}
	if got != chainTestRelease {
		t.Errorf("got release %q, want %q", got, chainTestRelease)
	}
}

func TestEnsureRelease_ConflictIsSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method %s", r.Method)
		}
		writeJSON(t, w, http.StatusConflict, map[string]string{"error": "already exists"})
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	got, err := c.EnsureRelease(context.Background(), chainTestOrg, chainTestProject, chainTestComp, chainTestRelease)
	if err != nil {
		t.Fatalf("EnsureRelease on 409: %v", err)
	}
	if got != chainTestRelease {
		t.Errorf("got release %q, want caller-supplied name on conflict", got)
	}
}

func TestEnsureRelease_ServerErrorWrapsSentinel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusInternalServerError, map[string]string{"error": "boom"})
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	_, err := c.EnsureRelease(context.Background(), chainTestOrg, chainTestProject, chainTestComp, chainTestRelease)
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrInternalServerError) {
		t.Errorf("expected ErrInternalServerError, got %v", err)
	}
}

func TestGenerateRelease_ReturnsControllerGeneratedName(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		writeJSON(t, w, http.StatusCreated, map[string]any{"metadata": map[string]any{"name": "widgets-api-r17"}})
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	got, err := c.GenerateRelease(context.Background(), chainTestOrg, chainTestProject, chainTestComp)
	if err != nil || got != "widgets-api-r17" {
		t.Fatalf("GenerateRelease = (%q, %v)", got, err)
	}
	if _, named := body["releaseName"]; named {
		t.Fatalf("auto-generated release request carried a name: %v", body)
	}
}

func TestLatestComponentRelease_ReadsComponentStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusOK, map[string]any{
			"metadata": map[string]any{"name": chainScopedName()},
			"spec": map[string]any{
				"componentType": map[string]any{"name": "deployment/service"},
				"owner":         map[string]any{"projectName": chainTestProject},
			},
			"status": map[string]any{"latestRelease": map[string]any{"name": "widgets-api-r18"}},
		})
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	got, err := c.LatestComponentRelease(context.Background(), chainTestOrg, chainTestProject, chainTestComp)
	if err != nil || got != "widgets-api-r18" {
		t.Fatalf("LatestComponentRelease = (%q, %v)", got, err)
	}
}

// ---- EnsureReleaseBinding ---------------------------------------------------

func TestEnsureReleaseBinding_Create(t *testing.T) {
	var gotPath, gotMethod string
	var gotBody map[string]any
	scoped := chainScopedName()
	bindingName := scoped + "-" + chainTestEnv
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		writeJSON(t, w, http.StatusCreated, map[string]any{
			"metadata": map[string]any{"name": bindingName},
		})
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	if err := c.EnsureReleaseBinding(context.Background(), chainTestOrg, chainTestProject,
		chainTestComp, chainTestEnv, chainTestRelease); err != nil {
		t.Fatalf("EnsureReleaseBinding: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/api/v1/namespaces/wc-abc/releasebindings" {
		t.Errorf("unexpected request: %s %s", gotMethod, gotPath)
	}
	meta, _ := gotBody["metadata"].(map[string]any)
	if meta["name"] != bindingName {
		t.Errorf("unexpected binding name: %v", meta["name"])
	}
	spec, _ := gotBody["spec"].(map[string]any)
	if spec["environment"] != chainTestEnv {
		t.Errorf("unexpected environment: %v", spec["environment"])
	}
}

func TestEnsureReleaseBinding_ConflictRepinsExistingBinding(t *testing.T) {
	requests := 0
	bindingName := chainScopedName() + "-" + chainTestEnv
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		switch {
		case requests == 1 && r.Method == http.MethodPost:
			writeJSON(t, w, http.StatusConflict, map[string]string{"error": "already exists"})
		case r.Method == http.MethodGet:
			writeJSON(t, w, http.StatusOK, map[string]any{
				"metadata": map[string]any{"name": bindingName},
				"spec": map[string]any{
					"environment": chainTestEnv,
					"owner":       map[string]any{"componentName": chainScopedName(), "projectName": chainTestProject},
					"releaseName": "old-release",
				},
			})
		case r.Method == http.MethodPut:
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["spec"].(map[string]any)["releaseName"] != chainTestRelease {
				t.Fatalf("releaseName = %v", body["spec"].(map[string]any)["releaseName"])
			}
			writeJSON(t, w, http.StatusOK, body)
		default:
			t.Fatalf("unexpected request %d: %s", requests, r.Method)
		}
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	if err := c.EnsureReleaseBinding(context.Background(), chainTestOrg, chainTestProject,
		chainTestComp, chainTestEnv, chainTestRelease); err != nil {
		t.Fatalf("EnsureReleaseBinding on 409: %v", err)
	}
	if requests != 3 {
		t.Fatalf("requests = %d, want POST+GET+PUT", requests)
	}
}

func TestEnsureReleaseBinding_ServerErrorWrapsSentinel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusInternalServerError, map[string]string{"error": "boom"})
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	err := c.EnsureReleaseBinding(context.Background(), chainTestOrg, chainTestProject,
		chainTestComp, chainTestEnv, chainTestRelease)
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrInternalServerError) {
		t.Errorf("expected ErrInternalServerError, got %v", err)
	}
}

func TestSetReleaseBindingState_ActivatesExistingBinding(t *testing.T) {
	requests := 0
	bindingName := chainScopedName() + "-" + chainTestEnv
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		switch r.Method {
		case http.MethodGet:
			writeJSON(t, w, http.StatusOK, map[string]any{
				"metadata": map[string]any{"name": bindingName},
				"spec": map[string]any{
					"environment": chainTestEnv,
					"owner":       map[string]any{"componentName": chainScopedName(), "projectName": chainTestProject},
					"releaseName": chainTestRelease,
				},
			})
		case http.MethodPut:
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			specBody := body["spec"].(map[string]any)
			if specBody["state"] != "Active" {
				t.Fatalf("state = %v", specBody["state"])
			}
			writeJSON(t, w, http.StatusOK, body)
		default:
			t.Fatalf("unexpected %s", r.Method)
		}
	}))
	defer srv.Close()

	c := newTestComponentClient(t, srv)
	if err := c.SetReleaseBindingState(context.Background(), chainTestOrg, chainTestProject, chainTestComp, chainTestEnv, "Active"); err != nil {
		t.Fatalf("SetReleaseBindingState: %v", err)
	}
	if requests != 2 {
		t.Fatalf("requests = %d, want GET+PUT", requests)
	}
}
