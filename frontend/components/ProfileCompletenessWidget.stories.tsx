import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ProfileCompletenessWidget from "./ProfileCompletenessWidget";
import type { ChecklistItem } from "@/components/Onboarding/ProfileChecklist";

const mockItems: ChecklistItem[] = [
  {
    id: "name",
    label: "Add your display name",
    completed: true,
    route: "/profile/edit",
    icon: <span>👤</span>,
  },
  {
    id: "bio",
    label: "Write a bio & hourly rate",
    completed: true,
    route: "/profile/edit",
    icon: <span>📝</span>,
  },
  {
    id: "skills",
    label: "Select at least 3 skills",
    completed: false,
    route: "/profile/edit",
    icon: <span>⚡</span>,
  },
  {
    id: "portfolio",
    label: "Add a portfolio project",
    completed: false,
    route: "/profile/edit",
    icon: <span>💼</span>,
  },
];

const meta: Meta<typeof ProfileCompletenessWidget> = {
  title: "Components/ProfileCompletenessWidget",
  component: ProfileCompletenessWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ProfileCompletenessWidget>;

export const PartialCompletion: Story = {
  args: {
    completionPercentage: 50,
    isComplete: false,
    checklistItems: mockItems,
  },
};

export const FullyComplete: Story = {
  args: {
    completionPercentage: 100,
    isComplete: true,
    checklistItems: mockItems.map((i) => ({ ...i, completed: true })),
  },
};
