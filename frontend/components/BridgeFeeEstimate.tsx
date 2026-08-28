import { useEffect, useState } from "react";

interface BridgeFeeEstimateProps {
  amount: string;
  chain: string;
  isWithdrawal?: boolean;
  estimatedTime?: string;
}

export default function BridgeFeeEstimate({ amount, chain, isWithdrawal = false, estimatedTime = "~2 minutes" }: BridgeFeeEstimateProps) {
  const [feeBps, setFeeBps] = useState(30);
  const [gasEstimate, setGasEstimate] = useState("$0.50");
  const [slippage, setSlippage] = useState("0.5%");

  useEffect(() => {
    if (chain === "ethereum") {
      setGasEstimate("$1.20");
      setFeeBps(30);
    } else if (chain === "polygon") {
      setGasEstimate("$0.05");
      setFeeBps(25);
    } else if (chain === "arbitrum") {
      setGasEstimate("$0.30");
      setFeeBps(25);
    } else if (chain === "optimism") {
      setGasEstimate("$0.25");
      setFeeBps(25);
    }
  }, [chain]);

  const calculateFee = () => {
    if (!amount) return "0.00";
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) return "0.00";
    const fee = amountNum * (feeBps / 10000);
    return fee.toFixed(2);
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
      <h3 className="font-medium text-gray-900">Fee Breakdown</h3>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Bridge Fee ({feeBps} bps)</span>
          <span className="font-medium">{calculateFee()}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-600">Network Gas</span>
          <span className="font-medium">{gasEstimate}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-600">Slippage Tolerance</span>
          <span className="font-medium">{slippage}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-600">Estimated Time</span>
          <span className="font-medium">{estimatedTime}</span>
        </div>
      </div>

      <div className="border-t pt-2 mt-2">
        <div className="flex justify-between font-medium">
          <span>You will {isWithdrawal ? "receive" : "deposit"}</span>
          <span>{amount || "0.00"}</span>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        Final amount may vary due to network conditions and slippage.
      </p>
    </div>
  );
}
