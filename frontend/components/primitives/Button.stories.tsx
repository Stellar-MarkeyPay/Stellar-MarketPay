import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Button from "./Button";

const meta: Meta<typeof Button> = {
  title: "Primitives/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost", "danger", "outline"],
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    isLoading: { control: "boolean" },
    disabled: { control: "boolean" },
    fullWidth: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    children: "Connect Wallet",
    variant: "primary",
    size: "md",
  },
};

export const Secondary: Story = {
  args: {
    children: "View Contract Details",
    variant: "secondary",
    size: "md",
  },
};

export const Ghost: Story = {
  args: {
    children: "Learn More →",
    variant: "ghost",
    size: "md",
  },
};

export const Danger: Story = {
  args: {
    children: "Raise Dispute",
    variant: "danger",
    size: "md",
  },
};

export const Outline: Story = {
  args: {
    children: "Export CSV",
    variant: "outline",
    size: "md",
  },
};

export const Loading: Story = {
  args: {
    children: "Submitting Transaction…",
    variant: "primary",
    isLoading: true,
  },
};

export const Disabled: Story = {
  args: {
    children: "Insufficient Balance",
    variant: "primary",
    disabled: true,
  },
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <Button
        variant="primary"
        leftIcon={
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        }
      >
        Post Job
      </Button>
      <Button
        variant="secondary"
        rightIcon={
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        }
      >
        Next Step
      </Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button size="sm">Small (36px)</Button>
      <Button size="md">Medium (44px)</Button>
      <Button size="lg">Large (52px)</Button>
    </div>
  ),
};
