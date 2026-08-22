import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Modal from "./Modal";
import Button from "./Button";

const meta: Meta<typeof Modal> = {
  title: "Primitives/Modal",
  component: Modal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Modal>;

function DefaultModal() {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Release Escrow Payment"
        description="Are you sure you want to release 500 XLM to the freelancer?"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => setOpen(false)}>
              Confirm Release
            </Button>
          </>
        }
      >
        <div className="space-y-3 py-2">
          <p>
            Releasing this payment will transfer the locked escrow funds directly into the
            freelancer&apos;s Stellar wallet. This action is on-chain and cannot be reversed.
          </p>
          <div className="rounded-xl bg-ink-800 p-3 border border-market-500/15">
            <p className="text-xs text-amber-700">Amount to Release</p>
            <p className="font-mono text-lg font-bold text-market-400">500.0000000 XLM</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export const Default: Story = {
  render: () => <DefaultModal />,
};

function LargeModalComponent() {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Open Large Modal</Button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Escrow Contract Terms"
        size="lg"
        footer={
          <Button variant="primary" size="sm" onClick={() => setOpen(false)}>
            I Understand
          </Button>
        }
      >
        <p className="leading-relaxed">
          All escrow interactions in Stellar MarketPay are governed by decentralized Soroban smart
          contracts. Funds remain secured until both parties agree to complete the contract, or a
          dispute is resolved by platform arbiters.
        </p>
      </Modal>
    </div>
  );
}

export const LargeModal: Story = {
  render: () => <LargeModalComponent />,
};
