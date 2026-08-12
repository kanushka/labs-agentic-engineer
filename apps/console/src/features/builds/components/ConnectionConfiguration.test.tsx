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

// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

type ComponentDependencies = components["schemas"]["ComponentDependencies"];
type ProjectDependencyReadiness =
  components["schemas"]["ProjectDependencyReadiness"];

const saveMutate = vi.fn();
let dependencies: ComponentDependencies[] = [];
let readiness: ProjectDependencyReadiness = { configured: false, dependencies: [] };

vi.mock("../../spec/api/queries", () => ({
  useDesignDependencies: () => ({
    data: dependencies,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../projects/api/queries", () => ({
  useProjectDependencyReadiness: () => ({
    data: readiness,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSaveConnectionValues: () => ({
    mutate: saveMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { ConnectionConfiguration } from "./ConnectionConfiguration";

function externalDependencies(...names: string[]): ComponentDependencies[] {
  return names.map((name, index) => ({
    componentName: `component-${index + 1}`,
    dependencies: [
      {
        kind: "external",
        name,
        description: `${name} connection`,
        config: [
          { key: "REGION", secret: false, defaultValue: "us-east-1" },
          { key: "API_KEY", secret: true, description: `${name} secret` },
        ],
      },
    ],
  }));
}

function renderConfiguration() {
  render(<ConnectionConfiguration projectName="acme" open />);
}

afterEach(() => {
  dependencies = [];
  readiness = { configured: false, dependencies: [] };
  saveMutate.mockClear();
});

describe("ConnectionConfiguration", () => {
  it("renders every external dependency card once", () => {
    dependencies = [
      ...externalDependencies("stripe", "twilio"),
      ...externalDependencies("stripe"),
    ];
    readiness = {
      configured: false,
      dependencies: [
        { name: "stripe", state: "unset", missingKeys: ["API_KEY"] },
        { name: "twilio", state: "unset", missingKeys: ["API_KEY"] },
      ],
    };

    renderConfiguration();

    expect(screen.getByRole("region", { name: "stripe" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "twilio" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "stripe" })).toHaveLength(1);
  });

  it("shows configured and missing-value statuses on their own cards", () => {
    dependencies = externalDependencies("stripe", "twilio");
    readiness = {
      configured: false,
      dependencies: [
        { name: "stripe", state: "configured", missingKeys: [] },
        { name: "twilio", state: "unset", missingKeys: ["API_KEY"] },
      ],
    };

    renderConfiguration();

    expect(within(screen.getByRole("region", { name: "stripe" })).getByText("Configured")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "twilio" })).getByText("Needs values")).toBeInTheDocument();
  });

  it("explains platform provisioning and prevents saving until it completes", () => {
    dependencies = externalDependencies("stripe");
    readiness = {
      configured: false,
      dependencies: [
        { name: "stripe", state: "not-provisioned", missingKeys: [] },
      ],
    };

    renderConfiguration();

    expect(screen.getByText(/platform is provisioning this connection/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save stripe values" })).toBeDisabled();
  });

  it("saves only the completed connection's development values", async () => {
    dependencies = externalDependencies("stripe", "twilio");
    readiness = {
      configured: false,
      dependencies: [
        { name: "stripe", state: "unset", missingKeys: ["API_KEY"] },
        { name: "twilio", state: "unset", missingKeys: ["API_KEY"] },
      ],
    };

    renderConfiguration();

    fireEvent.change(within(screen.getByRole("region", { name: "stripe" })).getByLabelText("API_KEY", { selector: "input" }), {
      target: { value: "stripe-secret" },
    });

    const saveStripe = screen.getByRole("button", { name: "Save stripe values" });
    await waitFor(() => expect(saveStripe).toBeEnabled());
    expect(screen.getByRole("button", { name: "Save twilio values" })).toBeDisabled();

    fireEvent.click(saveStripe);

    expect(saveMutate).toHaveBeenCalledWith({
      name: "stripe",
      environment: "development",
      values: { REGION: "us-east-1", API_KEY: "stripe-secret" },
    });
  });
});
