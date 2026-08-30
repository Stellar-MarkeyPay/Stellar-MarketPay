import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import FeeEstimationModal from "./FeeEstimationModal";
import type { Transaction } from "@stellar/stellar-sdk";

const mockTx = {
  fee: "100",
  toXDR: () => "mock-xdr-string",
} as unknown as Transaction;

const meta: Meta<typeof FeeEstimationModal> = {
  title: "Components/FeeEstimationModal",
  component: FeeEstimationModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof FeeEstimationModal>;

export const Default: Story = {
  args: {
    transaction: mockTx,
    functionName: "release_escrow",
    payerPublicKey: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    onConfirm: () => console.log("Confirmed"),
    onCancel: () => console.log("Cancelled"),
  },
};
