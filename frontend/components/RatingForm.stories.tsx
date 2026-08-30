import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import RatingForm from "./RatingForm";

const meta: Meta<typeof RatingForm> = {
  title: "Components/RatingForm",
  component: RatingForm,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof RatingForm>;

export const Default: Story = {
  args: {
    jobId: "job-101",
    ratedAddress: "GFREELANCER1234567890ABCDEFGHIJKLMNOPQRSTUV",
    ratedLabel: "Alex Rivera (Freelancer)",
    onSuccess: () => console.log("Rating Submitted"),
  },
};
