import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import XlmPriceWidget from "./XlmPriceWidget";

const meta: Meta<typeof XlmPriceWidget> = {
  title: "Components/XlmPriceWidget",
  component: XlmPriceWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof XlmPriceWidget>;

export const Default: Story = {};
