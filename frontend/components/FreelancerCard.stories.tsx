import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import FreelancerCard from "./FreelancerCard";
import type { UserProfile } from "@marketpay/shared-types";

const mockProfile: UserProfile = {
  publicKey: "GFREELANCER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  displayName: "Alex Rivera",
  bio: "Lead Soroban engineer and Rust core developer. 15+ marketplace contracts successfully deployed.",
  skills: ["Rust", "Soroban", "Smart Contracts", "Stellar SDK", "TypeScript", "Next.js"],
  role: "freelancer",
  tier: "Top Rated",
  rating: 4.95,
  completedJobs: 34,
  totalEarnedXLM: "48500.0000000",
  availability: {
    status: "available",
  },
  createdAt: "2025-06-01T00:00:00.000Z",
};

const meta: Meta<typeof FreelancerCard> = {
  title: "Components/FreelancerCard",
  component: FreelancerCard,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof FreelancerCard>;

export const Default: Story = {
  args: {
    profile: mockProfile,
    matchScore: 95,
  },
};

export const BusyAvailability: Story = {
  args: {
    profile: {
      ...mockProfile,
      availability: { status: "busy" },
      tier: "Rising Talent",
    },
    matchScore: 82,
  },
};

export const LongBioAndManySkills: Story = {
  args: {
    profile: {
      ...mockProfile,
      displayName: "Dr. Maximillian Alexander von Hohenheim-Stellar",
      bio: "Extensive experience across decentralized protocols, zero-knowledge verification, Soroban multi-sig architectures, cross-chain atomic swaps, and high-frequency automated liquidity market makers.".repeat(
        2
      ),
      skills: [
        "Rust",
        "Soroban",
        "C++",
        "Solidity",
        "TypeScript",
        "Python",
        "Go",
        "Docker",
        "Kubernetes",
        "WebAssembly",
        "Cryptography",
      ],
    },
    matchScore: 99,
  },
};
