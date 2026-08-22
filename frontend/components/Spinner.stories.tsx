import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Spinner from "./Spinner";

const meta: Meta<typeof Spinner> = {
  title: "Components/Spinner",
  component: Spinner,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Default: Story = {
  args: {
    className: "w-6 h-6 text-market-400",
  },
};

export const Large: Story = {
  args: {
    className: "w-12 h-12 text-market-400",
  },
};
