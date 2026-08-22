import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import EditProfileForm from "./EditProfileForm";

const meta: Meta<typeof EditProfileForm> = {
  title: "Components/EditProfileForm",
  component: EditProfileForm,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof EditProfileForm>;

export const Default: Story = {
  args: {
    publicKey: "GFREELANCER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  },
};
