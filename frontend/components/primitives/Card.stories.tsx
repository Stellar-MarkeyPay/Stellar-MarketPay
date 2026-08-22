import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Card from "./Card";
import Button from "./Button";

const meta: Meta<typeof Card> = {
  title: "Primitives/Card",
  component: Card,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card
      header={
        <div className="flex justify-between items-center">
          <h3 className="font-display font-bold text-amber-100">Project Overview</h3>
          <span className="text-xs text-market-400 font-mono">Active</span>
        </div>
      }
      footer={
        <div className="flex justify-between items-center text-xs text-amber-700">
          <span>Created 2 days ago</span>
          <Button size="sm" variant="ghost">
            View Details →
          </Button>
        </div>
      }
    >
      <p className="text-sm text-amber-200">
        Escrow funds are locked on-chain. Deliverables are awaiting client review.
      </p>
    </Card>
  ),
};

export const Hoverable: Story = {
  render: () => (
    <Card hoverable>
      <h3 className="font-display font-semibold text-amber-100 text-lg mb-2">
        Senior Smart Contract Engineer
      </h3>
      <p className="text-sm text-amber-800 line-clamp-2">
        Looking for an experienced Soroban smart contract developer to review and audit marketplace
        contracts.
      </p>
      <div className="mt-4 flex justify-between items-center text-xs">
        <span className="font-mono text-market-400 font-bold">1,200 XLM</span>
        <span className="text-amber-700">3 proposals</span>
      </div>
    </Card>
  ),
};
