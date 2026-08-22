import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Tooltips from "./Tooltips";

const meta: Meta<typeof Tooltips> = {
  title: "Components/Onboarding/Tooltips",
  component: Tooltips,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Tooltips>;

export const Default: Story = {
  render: () => (
    <div className="p-12 space-y-6">
      <div id="target-button" className="inline-block">
        <button className="btn-primary">Target Action Button</button>
      </div>
      <Tooltips
        tooltips={[
          {
            id: "tip-1",
            targetSelector: "#target-button",
            title: "Quick Action",
            description: "Click here to post your first smart contract job listing.",
            position: "bottom",
            action: {
              label: "Try it now",
              onClick: () => console.log("Action clicked"),
            },
          },
        ]}
        onDismiss={(id) => console.log("Dismissed:", id)}
        onDismissAll={() => console.log("Dismissed all")}
      />
    </div>
  ),
};
