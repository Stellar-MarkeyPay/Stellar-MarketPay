import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import JobAnalyticsPanel from "./JobAnalytics";
import type { Job } from "@/utils/types";

const mockJob: Job = {
  id: "job-101",
  title: "Soroban Smart Contract Escrow Development",
  description: "Build, test, and audit milestone escrow Soroban contract.",
  budget: "750.0000000",
  currency: "XLM",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban", "Security"],
  status: "open",
  clientAddress: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  applicantCount: 5,
  createdAt: "2026-02-15T12:00:00.000Z",
  updatedAt: "2026-02-15T12:00:00.000Z",
  expiresAt: "2026-03-15T12:00:00.000Z",
  extendedCount: 1,
};

const meta: Meta<typeof JobAnalyticsPanel> = {
  title: "Components/JobAnalytics",
  component: JobAnalyticsPanel,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof JobAnalyticsPanel>;

export const Default: Story = {
  args: {
    job: mockJob,
    onExtend: () => console.log("Extend Job Clicked"),
  },
};

export const ExpiringSoon: Story = {
  args: {
    job: {
      ...mockJob,
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    onExtend: () => console.log("Extend Job Clicked"),
  },
};

export const Expired: Story = {
  args: {
    job: {
      ...mockJob,
      expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    onExtend: () => console.log("Extend Job Clicked"),
  },
};
