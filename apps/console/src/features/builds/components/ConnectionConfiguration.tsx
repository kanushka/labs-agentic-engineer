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

import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import { ChevronDown } from "@wso2/oxygen-ui-icons-react";
import { StatusChip, type StatusTone } from "../../../components/StatusChip";
import { useSaveConnectionValues, useProjectDependencyReadiness } from "../../projects/api/queries";
import { connectionRows, type ConnectionValues } from "../../projects/lib/promotion";
import { ConnectionValueFields } from "../../projects/components/ConnectionValueFields";
import { useDesignDependencies } from "../../spec/api/queries";

const presentation = {
  "not-provisioned": {
    label: "Platform provisioning",
    tone: "info",
    canSave: false,
  },
  unset: { label: "Needs values", tone: "warning", canSave: true },
  configured: { label: "Configured", tone: "success", canSave: true },
} as const satisfies Record<
  "not-provisioned" | "unset" | "configured",
  { label: string; tone: StatusTone; canSave: boolean }
>;

function seedNonSecretDefaults(rows: ReturnType<typeof connectionRows>): ConnectionValues {
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      Object.fromEntries(
        row.config
          .filter((key) => !key.secret && key.defaultValue !== undefined)
          .map((key) => [key.key, key.defaultValue ?? ""]),
      ),
    ]),
  );
}

export function ConnectionConfiguration({
  projectName,
  open,
}: {
  projectName: string;
  open: boolean;
}) {
  const designDependencies = useDesignDependencies(projectName);
  const readiness = useProjectDependencyReadiness(projectName);
  const save = useSaveConnectionValues(projectName);
  const rows = useMemo(
    () => connectionRows(designDependencies.data).filter((row) => row.kind === "external"),
    [designDependencies.data],
  );
  const [values, setValues] = useState<ConnectionValues>({});
  const [expanded, setExpanded] = useState(open);

  // A deep link opens the section even if this component was already mounted;
  // after that, it remains an ordinary accordion users can open and close.
  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);

  // Values never come back from the platform (especially secrets), but plain
  // defaults in the design are legitimate initial input. Add them only once
  // for a card so refreshes never overwrite what the user is entering.
  useEffect(() => {
    const defaults = seedNonSecretDefaults(rows);
    setValues((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (next[row.id] === undefined) next[row.id] = defaults[row.id] ?? {};
      }
      return next;
    });
  }, [rows]);

  const readinessByName = new Map(
    (readiness.data?.dependencies ?? []).map((dependency) => [
      dependency.name,
      dependency,
    ]),
  );

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, nextExpanded) => setExpanded(nextExpanded)}
      disableGutters
      sx={{ mb: 3 }}
    >
      <AccordionSummary expandIcon={<ChevronDown size={18} />}>
        <Box>
          <Typography component="h2" variant="h6">
            Connection configuration
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Development values for external services used by this project.
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {designDependencies.isPending || readiness.isPending ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
            <CircularProgress aria-label="Loading connection configuration" />
          </Box>
        ) : designDependencies.isError || readiness.isError ? (
          <Stack spacing={1.5}>
            {designDependencies.isError && (
              <Alert
                severity="error"
                action={
                  <Button onClick={() => void designDependencies.refetch()}>
                    Retry
                  </Button>
                }
              >
                Failed to load the project&apos;s connection schema
              </Alert>
            )}
            {readiness.isError && (
              <Alert
                severity="error"
                action={<Button onClick={() => void readiness.refetch()}>Retry</Button>}
              >
                Failed to load connection readiness
              </Alert>
            )}
          </Stack>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            This project has no external connections to configure.
          </Typography>
        ) : (
          <Stack spacing={2}>
            {rows.map((row) => {
              const state = readinessByName.get(row.name)?.state ?? "unset";
              const status = presentation[state];
              const complete = row.config.every(
                (key) => (values[row.id]?.[key.key] ?? "").trim() !== "",
              );
              return (
                <Card key={row.id} component="section" aria-label={row.name} variant="outlined">
                  <CardContent>
                    <Stack spacing={2}>
                      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                        <Typography component="h3" variant="subtitle1">
                          {row.name}
                        </Typography>
                        <StatusChip label={status.label} tone={status.tone} appearance="soft" />
                      </Box>
                      {row.description && (
                        <Typography variant="body2" color="text.secondary">
                          {row.description}
                        </Typography>
                      )}
                      {state === "not-provisioned" ? (
                        <Typography variant="body2" color="text.secondary">
                          The platform is provisioning this connection. Values can be
                          saved once platform provisioning is complete.
                        </Typography>
                      ) : (
                        <ConnectionValueFields
                          config={row.config}
                          values={values[row.id] ?? {}}
                          onValueChange={(key, value) =>
                            setValues((current) => ({
                              ...current,
                              [row.id]: { ...current[row.id], [key]: value },
                            }))
                          }
                        />
                      )}
                      {save.isError && (
                        <Alert severity="error">
                          {save.error instanceof Error && save.error.message
                            ? save.error.message
                            : "Failed to save the connection's values"}
                        </Alert>
                      )}
                      <Box>
                        <Button
                          variant="contained"
                          disabled={!status.canSave || !complete || save.isPending}
                          onClick={() =>
                            save.mutate({
                              name: row.name,
                              environment: "development",
                              values: values[row.id] ?? {},
                            })
                          }
                        >
                          {save.isPending ? "Saving…" : `Save ${row.name} values`}
                        </Button>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
