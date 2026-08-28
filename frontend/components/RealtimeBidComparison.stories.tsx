import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import RealtimeBidComparison from "./RealtimeBidComparison";
import type { Application } from "@marketpay/shared-types";

const mockApplications: Application[] = [
  {
    id: "app-1",
    jobId: "job-101",
    freelancerAddress: "GFREELANCER1111111111111111111111111111111111111111111111",
    freelancerTier: "Top Rated",
    proposal: "Experienced Soroban smart contract engineer with proven track record.",
    bidAmount: "500.0000000",
    currency: "XLM",
    status: "pending",
    createdAt: "2026-03-01T10:00:00.000Z",
  },
  {
    id: "app-2",
    jobId: "job-101",
    freelancerAddress: "GFREELANCER2222222222222222222222222222222222222222222222",
    freelancerTier: "Rising Talent",
    proposal: "I can deliver the milestone contract and tests within 3 days.",
    bidAmount: "450.0000000",
    currency: "XLM",
    status: "pending",
    createdAt: "2026-03-01T11:00:00.000Z",
  },
];

const meta: Meta<typeof RealtimeBidComparison> = {
  title: "Components/RealtimeBidComparison",
  component: RealtimeBidComparison,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof RealtimeBidComparison>;

export const Default: Story = {
  args: {
    jobId: "job-101",
    initialApplications: mockApplications,
    isClient: true,
    biddingPhase: "commitment",
    onAcceptApplication: (id: any) => console.log("Accepted application:", id),
    onCloseBidding: () => console.log("Bidding closed"),
  },
};
