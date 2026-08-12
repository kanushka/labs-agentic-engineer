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

package app

import (
	"context"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

type fakeActiveRunFinder struct{ row *delivery.MilestoneRun }

func (f fakeActiveRunFinder) ActiveRunByProject(context.Context, string, string) (*delivery.MilestoneRun, error) {
	return f.row, nil
}

type fakeDependencyRunSignaler struct {
	row     *delivery.MilestoneRun
	name    string
	payload delivery.RunSignal
}

func (f *fakeDependencyRunSignaler) SignalRun(_ context.Context, row *delivery.MilestoneRun, name string, payload delivery.RunSignal) error {
	f.row, f.name, f.payload = row, name, payload
	return nil
}

func TestRunValuesSavedNotifierSignalsNewestActiveRun(t *testing.T) {
	row := &delivery.MilestoneRun{ID: "run-1", OrgID: "acme", ProjectID: "shop", MilestoneNumber: 7}
	signaler := &fakeDependencyRunSignaler{}
	n := runValuesSavedNotifier{runs: fakeActiveRunFinder{row: row}, signaler: signaler}

	if err := n.ValuesSaved(context.Background(), "acme", "shop"); err != nil {
		t.Fatalf("ValuesSaved: %v", err)
	}
	if signaler.row != row || signaler.name != delivery.SigRunDependencyValuesSaved {
		t.Fatalf("signal = row:%+v name:%q", signaler.row, signaler.name)
	}
	if signaler.payload.Signal != delivery.SigRunDependencyValuesSaved || signaler.payload.MilestoneNumber != 7 {
		t.Fatalf("payload = %+v", signaler.payload)
	}
}

func TestRunValuesSavedNotifierNoActiveRunIsNoop(t *testing.T) {
	signaler := &fakeDependencyRunSignaler{}
	n := runValuesSavedNotifier{runs: fakeActiveRunFinder{}, signaler: signaler}
	if err := n.ValuesSaved(context.Background(), "acme", "shop"); err != nil {
		t.Fatalf("ValuesSaved: %v", err)
	}
	if signaler.name != "" {
		t.Fatalf("unexpected signal %q", signaler.name)
	}
}
