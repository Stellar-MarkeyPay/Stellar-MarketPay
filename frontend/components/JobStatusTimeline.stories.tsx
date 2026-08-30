import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import JobStatusTimeline from "./JobStatusTimeline";
import type { Job } from "@/utils/types";

const baseJob: Job = {
  id: "job-101",
  title: "Soroban Smart Contract Escrow",
  description: "Marketplace milestone contract",
  budget: "500",
  currency: "XLM",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban"],
  status: "open",
  clientAddress: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  applicantCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const meta: Meta<typeof JobStatusTimeline> = {
  title: "Components/JobStatusTimeline",
  component: JobStatusTimeline,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof JobStatusTimeline>;

export const Open: Story = {
  args: {
    job: baseJob,
    compact: false,
  },
};

export const InProgress: Story = {
  args: {
    job: {
      ...baseJob,
      status: "in_progress",
      freelancerAddress: "GFREELANCER1234567890ABCDEFGHIJKLMNOPQRSTUV",
    },
    compact: false,
  },
};

export const Completed: Story = {
  args: {
    job: {
      ...baseJob,
      status: "completed",
      freelancerAddress: "GFREELANCER1234567890ABCDEFGHIJKLMNOPQRSTUV",
    },
    compact: false,
  },
};

export const Disputed: Story = {
  args: {
    job: {
      ...baseJob,
      status: "disputed",
      freelancerAddress: "GFREELANCER1234567890ABCDEFGHIJKLMNOPQRSTUV",
      disputeReason: "Deliverable not matching milestone specification",
    },
    compact: false,
  },
};

export const CompactMode: Story = {
  args: {
    job: {
      ...baseJob,
      status: "in_progress",
      freelancerAddress: "GFREELANCER1234567890ABCDEFGHIJKLMNOPQRSTUV",
    },
    compact: true,
  },
};
