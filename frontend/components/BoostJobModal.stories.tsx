import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import BoostJobModal from "./BoostJobModal";

const meta: Meta<typeof BoostJobModal> = {
  title: "Components/BoostJobModal",
  component: BoostJobModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof BoostJobModal>;

export const Default: Story = {
  args: {
    jobId: "job-1",
    jobTitle: "Senior Soroban Smart Contract Engineer",
    clientPublicKey: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUV",
    onClose: () => console.log("Closed"),
    onSuccess: (until) => console.log("Boosted until:", until),
  },
};

export const LongJobTitle: Story = {
  args: {
    jobId: "job-2",
    jobTitle:
      "Enterprise Multi-Sig Escrow Contract with Automated Settlement and Cross-Border Liquidity Rails",
    clientPublicKey: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUV",
    onClose: () => console.log("Closed"),
    onSuccess: (until) => console.log("Boosted until:", until),
  },
};
