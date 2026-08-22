import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import FreelancerTierBadge from "./FreelancerTierBadge";

const meta: Meta<typeof FreelancerTierBadge> = {
  title: "Components/FreelancerTierBadge",
  component: FreelancerTierBadge,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof FreelancerTierBadge>;

export const Newcomer: Story = {
  args: {
    tier: "Newcomer",
  },
};

export const RisingTalent: Story = {
  args: {
    tier: "Rising Talent",
  },
};

export const TopRated: Story = {
  args: {
    tier: "Top Rated",
  },
};

export const Expert: Story = {
  args: {
    tier: "Expert",
  },
};

export const AllTiers: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <FreelancerTierBadge tier="Newcomer" />
      <FreelancerTierBadge tier="Rising Talent" />
      <FreelancerTierBadge tier="Top Rated" />
      <FreelancerTierBadge tier="Expert" />
    </div>
  ),
};
