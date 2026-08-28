import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ClientSpendingTab from "./ClientSpendingTab";
import type { ClientSpendingAnalytics } from "@marketpay/shared-types";

const mockAnalytics: ClientSpendingAnalytics = {
  totalSpentXlm: "12500.0000000",
  jobsBreakdown: {
    posted: 12,
    completed: 9,
    cancelled: 1,
    inProgress: 2,
  },
  averageBudgetXlm: "1100.0000000",
  averagePaidXlm: "1388.8800000",
  topFreelancers: [
    {
      freelancerAddress: "GFREELANCER1111111111111111111111111111111111111111111111",
      jobsCount: 4,
      totalPaidXlm: "6000.0000000",
    },
    {
      freelancerAddress: "GFREELANCER2222222222222222222222222222222222222222222222",
      jobsCount: 3,
      totalPaidXlm: "4200.0000000",
    },
  ],
  hasCompletedJobs: true,
};

const meta: Meta<typeof ClientSpendingTab> = {
  title: "Components/ClientSpendingTab",
  component: ClientSpendingTab,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ClientSpendingTab>;

export const Default: Story = {
  args: {
    analytics: mockAnalytics,
    loading: false,
    xlmPriceUsd: 0.12,
  },
};

export const Loading: Story = {
  args: {
    analytics: null,
    loading: true,
    xlmPriceUsd: 0.12,
  },
};

export const EmptyNoCompletedJobs: Story = {
  args: {
    analytics: {
      ...mockAnalytics,
      hasCompletedJobs: false,
    },
    loading: false,
    xlmPriceUsd: 0.12,
  },
};
