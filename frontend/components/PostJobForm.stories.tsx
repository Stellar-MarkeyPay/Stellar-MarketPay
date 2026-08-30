import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import PostJobForm from "./PostJobForm";

const meta: Meta<typeof PostJobForm> = {
  title: "Components/PostJobForm",
  component: PostJobForm,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof PostJobForm>;

export const Default: Story = {
  args: {
    publicKey: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  },
};

export const PrefilledCategory: Story = {
  args: {
    publicKey: "GCLIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    initialCategory: "Smart Contracts",
    suggestedFreelancer: "GFREELANCER1234567890ABCDEFGHIJKLMNOPQRSTUV",
  },
};
