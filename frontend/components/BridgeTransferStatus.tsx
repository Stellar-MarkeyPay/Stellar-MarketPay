import { useEffect, useState } from "react";

interface BridgeTransferStatusProps {
  txHash: string;
  confirmations: number;
  requiredConfirmations: number;
  estimatedTime: string;
}

export default function BridgeTransferStatus({ txHash, confirmations, requiredConfirmations, estimatedTime }: BridgeTransferStatusProps) {
  const progress = Math.min((confirmations / requiredConfirmations) * 100, 100);

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
      <h2 className="text-xl font-semibold text-blue-800 mb-4">Confirming Transaction</h2>

      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span>Confirmations</span>
          <span>
            {confirmations} / {requiredConfirmations}
          </span>
        </div>
        <div className="w-full bg-blue-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="space-y-2 text-sm text-blue-700">
        <p>Estimated time remaining: {estimatedTime}</p>
        <p className="font-mono break-all">TX: {txHash}</p>
      </div>

      {progress >= 100 && (
        <div className="mt-4 p-3 bg-green-100 border border-green-300 rounded">
          <p className="text-green-800 font-medium">Transaction finalized!</p>
        </div>
      )}
    </div>
  );
}
