import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import ProfileChecklist, { ChecklistItem } from "./ProfileChecklist";

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
    completed: false,
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

const meta: Meta<typeof ProfileChecklist> = {
  title: "Components/Onboarding/ProfileChecklist",
  component: ProfileChecklist,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ProfileChecklist>;

export const PartialCompletion: Story = {
  args: {
    items: mockItems,
    onItemClick: (r) => console.log("Clicked route:", r),
    onDismiss: () => console.log("Dismissed"),
  },
};

export const FullyComplete: Story = {
  args: {
    items: mockItems.map((i) => ({ ...i, completed: true })),
    onItemClick: (r) => console.log("Clicked route:", r),
    onDismiss: () => console.log("Dismissed"),
  },
};
