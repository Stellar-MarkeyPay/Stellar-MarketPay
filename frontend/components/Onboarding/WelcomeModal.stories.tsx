import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import WelcomeModal from "./WelcomeModal";

const meta: Meta<typeof WelcomeModal> = {
  title: "Components/Onboarding/WelcomeModal",
  component: WelcomeModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof WelcomeModal>;

export const Default: Story = {
  args: {
    isOpen: true,
    onClose: () => console.log("Closed"),
    onGetStarted: () => console.log("Get Started"),
  },
};
