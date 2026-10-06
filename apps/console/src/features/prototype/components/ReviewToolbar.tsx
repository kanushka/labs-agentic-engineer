/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import type { ChangeEvent, ReactNode } from "react";
import { Box, Button, TextField, Tooltip } from "@wso2/oxygen-ui";
import { MessageCirclePlus, MousePointer2, RotateCcw } from "@wso2/oxygen-ui-icons-react";
import { screensForRole, type PrototypeManifest, type PrototypeViewEvent, type PrototypeViewState } from "@wso2/prototype-kit/host";

const NO_FLOW = "";

function Picker({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      sx={{ minWidth: 150 }}
    >
      {children}
    </TextField>
  );
}

/** A tint of the primary colour, for the active Comment tool and the mode's ring. */
export const PRIMARY_TINT = "rgba(var(--oxygen-palette-primary-mainChannel) / 0.16)";

/**
 * One of the mode tools: labelled, with its shortcut in the tooltip. The
 * active one is pressed: `primary` tints it (Comment), `neutral` greys it (Preview).
 */
function Tool({
  label,
  shortcut,
  icon,
  pressed,
  tone,
  onClick,
}: {
  label: string;
  shortcut: string;
  icon: ReactNode;
  pressed: boolean;
  tone: "neutral" | "primary";
  onClick: () => void;
}) {
  return (
    <Tooltip title={`${label} · ${shortcut}`} describeChild>
      <Button
        size="small"
        color="inherit"
        aria-pressed={pressed}
        startIcon={icon}
        onClick={onClick}
        sx={{
          textTransform: "none",
          fontWeight: 500,
          px: 1.25,
          py: 0.5,
          borderRadius: 1.5,
          color: "text.secondary",
          "&:hover": { bgcolor: "action.hover", color: "text.primary" },
          '&[aria-pressed="true"]': tone === "primary" ? { bgcolor: PRIMARY_TINT, color: "primary.main" } : { bgcolor: "action.selected", color: "text.primary" },
        }}
      >
        {label}
      </Button>
    </Tooltip>
  );
}

/**
 * The review's controls, as the kit CLI's host has them: screen, flow, role
 * and display-state pickers, Reset data, and the Preview · Comment tool pair
 * (Comment is the reviewer's word for the view's Annotate mode).
 * Every change goes through the kit's view reducer, which keeps the view
 * reachable for the role.
 */
export function ReviewToolbar({
  manifest,
  view,
  dispatch,
  onReset,
}: {
  manifest: PrototypeManifest;
  view: PrototypeViewState;
  dispatch: (event: PrototypeViewEvent) => void;
  onReset: () => void;
}) {
  return (
    <Box role="toolbar" aria-label="Review" sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 }}>
      <Picker label="Screen" value={view.screenId} onChange={(screenId) => dispatch({ type: "NAVIGATE", screenId })}>
        {screensForRole(manifest, view.roleId).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Picker>
      <Picker
        label="Flow"
        value={view.flowId ?? NO_FLOW}
        onChange={(flowId) => dispatch({ type: "SET_FLOW", flowId: flowId === NO_FLOW ? null : flowId })}
      >
        <option value={NO_FLOW}>No flow</option>
        {manifest.flows.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </Picker>
      <Picker label="Role" value={view.roleId} onChange={(roleId) => dispatch({ type: "SET_ROLE", roleId })}>
        {manifest.roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Picker>
      <Picker label="State" value={view.stateId} onChange={(stateId) => dispatch({ type: "SET_STATE", stateId })}>
        {manifest.states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Picker>
      <Button size="small" variant="outlined" startIcon={<RotateCcw size={16} />} onClick={onReset}>
        Reset data
      </Button>
      <Box role="group" aria-label="Mode" sx={{ display: "inline-flex", gap: 0.25, p: 0.375, border: 1, borderColor: "divider", borderRadius: 2.5 }}>
        <Tool
          label="Preview"
          shortcut="V"
          icon={<MousePointer2 size={16} />}
          pressed={view.mode === "preview"}
          tone="neutral"
          onClick={() => dispatch({ type: "EXIT_ANNOTATE" })}
        />
        <Tool
          label="Comment"
          shortcut="C"
          icon={<MessageCirclePlus size={16} />}
          pressed={view.mode === "annotate"}
          tone="primary"
          onClick={() => dispatch({ type: "ENTER_ANNOTATE" })}
        />
      </Box>
    </Box>
  );
}
