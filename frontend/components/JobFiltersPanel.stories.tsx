import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import JobFiltersPanel from "./JobFiltersPanel";

const meta: Meta<typeof JobFiltersPanel> = {
  title: "Components/JobFiltersPanel",
  component: JobFiltersPanel,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof JobFiltersPanel>;

export const Default: Story = {
  args: {
    query: {},
    onQueryChange: (patch) => console.log("Query changed:", patch),
  },
};

export const WithActiveFilters: Story = {
  args: {
    query: {
      minBudget: "200",
      maxBudget: "2000",
      skills: "Rust,Soroban",
      minClientRating: "4",
      duration: "1_to_3_months",
    },
    onQueryChange: (patch) => console.log("Query changed:", patch),
  },
};
