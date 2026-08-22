import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Input from "./Input";

const meta: Meta<typeof Input> = {
  title: "Primitives/Input",
  component: Input,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    label: "Project Title",
    placeholder: "e.g. Build Soroban Smart Contract",
    helperText: "Keep it descriptive and under 100 characters.",
  },
};

export const WithError: Story = {
  args: {
    label: "Budget (XLM)",
    value: "-50",
    error: "Budget must be greater than 0 XLM.",
  },
};

export const WithIcons: Story = {
  args: {
    label: "Search Jobs",
    placeholder: "Search by title, skill, or keyword…",
    leftIcon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    ),
  },
};

export const Disabled: Story = {
  args: {
    label: "Contract ID",
    value: "CBK4MOCKCONTRACTID1234567890",
    disabled: true,
    helperText: "Locked by smart contract.",
  },
};
