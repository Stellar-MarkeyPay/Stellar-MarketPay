import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import JobCompletionPredictionPanel from "./JobCompletionPrediction";
import type { JobCompletionPrediction } from "@marketpay/shared-types";

const mockPrediction: JobCompletionPrediction = {
  estimatedDurationDays: 14,
  estimatedCompletionDate: "2026-04-01T00:00:00.000Z",
  confidenceScore: 88,
  freelancerStats: {
    completedJobs: 24,
    rating: 4.9,
    onTimeRate: 96,
  },
};

const meta: Meta<typeof JobCompletionPredictionPanel> = {
  title: "Components/JobCompletionPrediction",
  component: JobCompletionPredictionPanel,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof JobCompletionPredictionPanel>;

export const HighConfidence: Story = {
  args: {
    prediction: mockPrediction,
    compact: false,
  },
};

export const ModerateConfidence: Story = {
  args: {
    prediction: {
      ...mockPrediction,
      confidenceScore: 65,
      freelancerStats: {
        completedJobs: 5,
        rating: 4.2,
        onTimeRate: 75,
      },
    },
    compact: false,
  },
};

export const LowConfidence: Story = {
  args: {
    prediction: {
      ...mockPrediction,
      confidenceScore: 40,
      freelancerStats: {
        completedJobs: 1,
        rating: 3.5,
        onTimeRate: 50,
      },
    },
    compact: false,
  },
};

export const Compact: Story = {
  args: {
    prediction: mockPrediction,
    compact: true,
  },
};
