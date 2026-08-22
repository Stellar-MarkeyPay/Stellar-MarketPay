import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Textarea from "./Textarea";

const meta: Meta<typeof Textarea> = {
  title: "Primitives/Textarea",
  component: Textarea,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: {
    label: "Project Description",
    placeholder: "Provide detailed requirements, scope, deliverables, and timeline…",
    helperText: "Markdown formatting is supported.",
  },
};

export const WithCharacterCount: Story = {
  args: {
    label: "Freelancer Bio",
    value: "Senior Rust and Soroban developer with 5+ years in decentralized systems.",
    maxLength: 300,
    showCharCount: true,
  },
};

export const WithError: Story = {
  args: {
    label: "Proposal Cover Letter",
    value: "Too short",
    error: "Proposal must be at least 50 characters.",
  },
};
