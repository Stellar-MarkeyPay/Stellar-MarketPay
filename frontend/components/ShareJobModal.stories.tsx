import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ShareJobModal from "./ShareJobModal";
import type { Job } from "@marketpay/shared-types";

const mockJob: Job = {
  id: "job-101",
  title: "Soroban Smart Contract Escrow Development",
  description: "Build, test, and audit milestone escrow Soroban contract.",
  budget: "750.0000000",
  currency: "XLM",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban"],
  status: "open",
  clientAddress: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  applicantCount: 3,
  createdAt: "2026-02-01T12:00:00.000Z",
  updatedAt: "2026-02-01T12:00:00.000Z",
};

const meta: Meta<typeof ShareJobModal> = {
  title: "Components/ShareJobModal",
  component: ShareJobModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ShareJobModal>;

export const Default: Story = {
  args: {
    job: mockJob,
    onClose: () => console.log("Closed"),
  },
};
