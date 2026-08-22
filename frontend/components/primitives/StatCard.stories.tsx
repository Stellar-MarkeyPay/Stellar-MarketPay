import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import StatCard from "./StatCard";

const meta: Meta<typeof StatCard> = {
  title: "Primitives/StatCard",
  component: StatCard,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof StatCard>;

export const Default: Story = {
  args: {
    title: "Total XLM in Escrow",
    value: "45,280.50 XLM",
    subtitle: "Across 18 active marketplace contracts",
    change: {
      value: "+12.4%",
      trend: "up",
    },
    colorScheme: "gold",
  },
};

export const Grid: Story = {
  render: () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Completed Jobs"
        value="128"
        subtitle="98.4% success rate"
        change={{ value: "+8%", trend: "up" }}
        colorScheme="green"
      />
      <StatCard title="Active Escrows" value="14" subtitle="5 releasing today" colorScheme="gold" />
      <StatCard
        title="Total Earnings"
        value="18,450 XLM"
        subtitle="Ranked #4 Top Earner"
        change={{ value: "+24%", trend: "up" }}
        colorScheme="blue"
      />
      <StatCard
        title="Dispute Rate"
        value="0.8%"
        subtitle="Down from 1.2%"
        change={{ value: "-0.4%", trend: "down" }}
        colorScheme="red"
      />
    </div>
  ),
};
