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
	"errors"

	"github.com/wso2/aep/aep-api/internal/spec"
)

// designFilesCommitter adapts the Files API (feature/files) to design's narrow
// designFileCommitter port — the committed-truth single-commit write surface
// the design service uses to persist a dependency's contract + its
// dependency.json (and the user's acceptance of an assumed contract) atomically
// to main. It lives at the composition root so the
// design feature imports only artifacts (arch boundary), never the files service directly.
type designFilesCommitter struct {
	files spec.FilesService
}

// workloadReader is the eventcore wiring-conformance check's file read: the
// shipped workload.yaml at HEAD. It is the same Files surface designFilesCommitter
// uses, projected onto the narrower shape eventcore holds (no CAS token — the
// check never writes).
type workloadReader struct {
	files spec.FilesService
}

func (a workloadReader) ReadFile(ctx context.Context, orgID, projectID, path string) (string, bool, error) {
	fc, err := a.files.Read(ctx, orgID, projectID, path)
	if err != nil {
		if errors.Is(err, spec.ErrFileNotFound) {
			return "", false, nil
		}
		return "", false, err
	}
	return fc.Content, true, nil
}

// ReadFile returns a file's current content + blob sha (the CAS token). A file
// absent at HEAD is reported as ok=false with no error (a fresh spec create).
func (a designFilesCommitter) ReadFile(ctx context.Context, orgID, projectID, path string) (content, sha string, ok bool, err error) {
	fc, rerr := a.files.Read(ctx, orgID, projectID, path)
	if rerr != nil {
		if errors.Is(rerr, spec.ErrFileNotFound) {
			return "", "", false, nil
		}
		return "", "", false, rerr
	}
	return fc.Content, fc.SHA, true, nil
}

// Commit writes every file in one atomic apply → main under per-file baseSha
// CAS. A stale precondition (concurrent design edit) surfaces as
// spec.ErrSpecCommitConflict so the route can 409.
func (a designFilesCommitter) Commit(ctx context.Context, orgID, projectID string, writes []spec.DesignFileWrite, message string) error {
	ops := make([]spec.WriteOp, 0, len(writes))
	for _, w := range writes {
		ops = append(ops, spec.WriteOp{Path: w.Path, Content: w.Content, BaseSHA: w.BaseSHA})
	}
	_, conflicts, err := a.files.Apply(ctx, orgID, projectID, spec.ApplyRequest{Writes: ops, Message: message})
	if err != nil {
		if errors.Is(err, spec.ErrApplyConflict) {
			return spec.ErrSpecCommitConflict
		}
		return err
	}
	if len(conflicts) > 0 {
		return spec.ErrSpecCommitConflict
	}
	return nil
}
