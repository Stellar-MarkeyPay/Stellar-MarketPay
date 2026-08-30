import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import PluginFrame from "./PluginFrame";

const meta: Meta<typeof PluginFrame> = {
  title: "Components/PluginFrame",
  component: PluginFrame,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Sandboxed renderer for a third-party plugin's UI surface — an iframe with `sandbox=\"allow-scripts\"` and no `allow-same-origin`, so the plugin gets an opaque origin with zero access to the host page, its cookies, or any wallet extension API. All communication is mediated `postMessage` — see the component's doc comment for the full security rationale.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof PluginFrame>;

const SIMPLE_UI_SOURCE = `
  document.getElementById("root").innerHTML =
    '<div style="padding:16px;font-size:14px;">Hello from a sandboxed plugin UI 👋</div>';
`;

const DATA_FETCHING_UI_SOURCE = `
  var root = document.getElementById("root");
  root.innerHTML = '<div style="padding:16px;">Loading job…</div>';
  marketpay.call("jobs.get", { jobId: "demo-job-1" }).then(function (job) {
    root.innerHTML = '<div style="padding:16px;"><strong>' + job.title + '</strong><br/>Budget: ' + job.budget + '</div>';
  }).catch(function (err) {
    root.innerHTML = '<div style="padding:16px;color:red;">Failed to load: ' + err.message + '</div>';
  });
`;

const SIGNING_UI_SOURCE = `
  var root = document.getElementById("root");
  var button = document.createElement("button");
  button.textContent = "Request signature";
  button.onclick = function () {
    root.appendChild(document.createTextNode(" Requesting..."));
    marketpay.requestSign({ description: "Approve 10 XLM payment", transactionXdr: "AAAA..." })
      .then(function (result) {
        root.innerHTML += result.signed ? " ✅ Signed" : " ❌ Declined";
      });
  };
  root.appendChild(button);
`;

const CRASHING_UI_SOURCE = `throw new Error("intentional plugin bug for the story");`;

export const Default: Story = {
  args: {
    pluginId: "demo-plugin",
    pluginName: "Demo Plugin",
    uiSource: SIMPLE_UI_SOURCE,
    heightPx: 120,
    onRequestSign: async () => ({ signed: true, signedXdr: "signed-xdr" }),
    onDataRequest: async () => ({}),
  },
};

export const FetchingData: Story = {
  args: {
    ...Default.args,
    pluginId: "data-plugin",
    pluginName: "Data Plugin",
    uiSource: DATA_FETCHING_UI_SOURCE,
    heightPx: 140,
    onDataRequest: async (method) => {
      if (method === "jobs.get") {
        return { id: "demo-job-1", title: "Build a Soroban dashboard", budget: "1500 XLM" };
      }
      throw new Error(`unhandled method in story: ${method}`);
    },
  },
};

export const RequestingASignature: Story = {
  args: {
    ...Default.args,
    pluginId: "signing-plugin",
    pluginName: "Signing Plugin",
    uiSource: SIGNING_UI_SOURCE,
    heightPx: 120,
    onRequestSign: async (payload) => {
      // In the real app this opens the host's own confirmation UI and
      // calls into lib/wallet.ts — the plugin never sees Freighter itself.
      // eslint-disable-next-line no-alert
      const approved = typeof window !== "undefined" ? window.confirm(payload.description) : true;
      return { signed: approved, signedXdr: approved ? "signed-xdr" : undefined };
    },
  },
};

export const PluginCrashed: Story = {
  args: {
    ...Default.args,
    pluginId: "broken-plugin",
    pluginName: "Broken Plugin",
    uiSource: CRASHING_UI_SOURCE,
    heightPx: 120,
  },
};

export const LongContent: Story = {
  args: {
    ...Default.args,
    pluginId: "overflow-plugin",
    pluginName: "Overflow Plugin",
    uiSource: `
      var root = document.getElementById("root");
      for (var i = 0; i < 30; i++) {
        var p = document.createElement("p");
        p.textContent = "Plugin-rendered line " + i;
        p.style.margin = "4px 0";
        root.appendChild(p);
      }
    `,
    heightPx: 200,
  },
};
