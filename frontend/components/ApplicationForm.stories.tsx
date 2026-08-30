import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ApplicationForm from "./ApplicationForm";
import type { Job } from "@/utils/types";

const mockJob: Job = {
  id: "job-101",
  title: "Soroban Smart Contract Escrow Development",
  description: "Build, test, and audit a milestone escrow Soroban contract on Stellar Testnet.",
  budget: "750.0000000",
  currency: "XLM",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban", "Stellar SDK"],
  status: "open",
  clientAddress: "GCLIENTACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  applicantCount: 3,
  createdAt: "2026-03-01T12:00:00.000Z",
  updatedAt: "2026-03-01T12:00:00.000Z",
  screeningQuestions: [
    "How many Soroban smart contracts have you deployed to Testnet/Mainnet?",
    "Can you provide a link to your previous Rust or Soroban code?",
  ],
};

const meta: Meta<typeof ApplicationForm> = {
  title: "Components/ApplicationForm",
  component: ApplicationForm,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ApplicationForm>;

export const Default: Story = {
  args: {
    job: mockJob,
    publicKey: "GFREELANCERACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUV",
    onSuccess: () => console.log("Application Submitted"),
  },
};

export const PrefilledProposal: Story = {
  args: {
    job: mockJob,
    publicKey: "GFREELANCERACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUV",
    prefillData: {
      bidAmount: "650",
      message:
        "I have built 4 Soroban contracts with full test suites. Happy to deliver within 5 days.",
    },
    onSuccess: () => console.log("Application Submitted"),
  },
};

export const LongContentJob: Story = {
  args: {
    job: {
      ...mockJob,
      title:
        "Extremely Long Project Title with Multi-Stage Milestones, Cross-Border Settlement, and Zero-Knowledge Proofs on Stellar",
      description:
        "Detailed description that covers extensive technical requirements, architecture constraints, Soroban SDK versions, security audit expectations, multi-sig escrow setup, and automated dispute resolution mechanisms.".repeat(
          3
        ),
    },
    publicKey: "GFREELANCERACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUV",
    onSuccess: () => console.log("Application Submitted"),
  },
};
