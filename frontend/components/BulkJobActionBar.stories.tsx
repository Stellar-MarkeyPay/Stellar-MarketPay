import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import BulkJobActionBar from "./BulkJobActionBar";

const meta: Meta<typeof BulkJobActionBar> = {
  title: "Components/BulkJobActionBar",
  component: BulkJobActionBar,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof BulkJobActionBar>;

export const SingleSelected: Story = {
  args: {
    selectedCount: 1,
    loading: false,
    onCancel: async () => ({
      success: true,
      succeeded: 1,
      failed: 0,
      processedCount: 1,
      failedCount: 0,
      results: [],
    }),
    onExtend: async () => ({
      success: true,
      succeeded: 1,
      failed: 0,
      processedCount: 1,
      failedCount: 0,
      results: [],
    }),
    onBoost: async () => ({
      success: true,
      succeeded: 1,
      failed: 0,
      processedCount: 1,
      failedCount: 0,
      results: [],
    }),
    onClearSelection: () => console.log("Clear Selection"),
  },
};

export const MultipleSelected: Story = {
  args: {
    selectedCount: 5,
    loading: false,
    onCancel: async () => ({
      success: true,
      succeeded: 5,
      failed: 0,
      processedCount: 5,
      failedCount: 0,
      results: [],
    }),
    onExtend: async () => ({
      success: true,
      succeeded: 5,
      failed: 0,
      processedCount: 5,
      failedCount: 0,
      results: [],
    }),
    onBoost: async () => ({
      success: true,
      succeeded: 5,
      failed: 0,
      processedCount: 5,
      failedCount: 0,
      results: [],
    }),
    onClearSelection: () => console.log("Clear Selection"),
  },
};

export const LoadingState: Story = {
  args: {
    selectedCount: 3,
    loading: true,
    onCancel: async () => ({
      success: true,
      succeeded: 3,
      failed: 0,
      processedCount: 3,
      failedCount: 0,
      results: [],
    }),
    onExtend: async () => ({
      success: true,
      succeeded: 3,
      failed: 0,
      processedCount: 3,
      failedCount: 0,
      results: [],
    }),
    onBoost: async () => ({
      success: true,
      succeeded: 3,
      failed: 0,
      processedCount: 3,
      failedCount: 0,
      results: [],
    }),
    onClearSelection: () => console.log("Clear Selection"),
  },
};
