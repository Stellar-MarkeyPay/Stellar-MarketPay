import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import JobCard, { JobCardSkeleton } from "./JobCard";
import type { Job } from "@/utils/types";

const mockJob: Job = {
  id: "job-101",
  title: "Build Soroban Escrow Contract for Marketplace",
  description:
    "Need a secure Soroban escrow contract with milestone releases and dispute resolution mechanism on Stellar Testnet.",
  budget: "1200.0000000",
  currency: "XLM",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban", "Escrow", "Auditing"],
  status: "open",
  clientAddress: "GCLIENTACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  applicantCount: 4,
  clientReputationScore: 4.8,
  createdAt: "2026-02-15T12:00:00.000Z",
  updatedAt: "2026-02-15T12:00:00.000Z",
};

const meta: Meta<typeof JobCard> = {
  title: "Components/JobCard",
  component: JobCard,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof JobCard>;

export const Default: Story = {
  args: {
    job: mockJob,
  },
};

export const FeaturedBoosted: Story = {
  args: {
    job: {
      ...mockJob,
      boosted: true,
      boostedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
};

export const ClosingSoonWithDeadline: Story = {
  args: {
    job: {
      ...mockJob,
      deadline: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
    },
  },
};

export const ClosedJob: Story = {
  args: {
    job: {
      ...mockJob,
      status: "completed",
    },
  },
};

export const LongContentAndManySkills: Story = {
  args: {
    job: {
      ...mockJob,
      title:
        "Extremely Long Project Title with Complex Multi-Stage Milestone Architecture, Cross-Border Payments, and Automated Stellar Liquidity Pools",
      description:
        "Comprehensive requirements including full smart contract test suite, continuous integration workflows, formal verification, front-end SDK integration, security audit documentation, and deployment guides.".repeat(
          2
        ),
      skills: [
        "Rust",
        "Soroban",
        "Stellar SDK",
        "TypeScript",
        "Next.js",
        "TailwindCSS",
        "Jest",
        "Playwright",
        "Docker",
      ],
    },
  },
};

export const Skeleton: Story = {
  render: () => <JobCardSkeleton />,
};
