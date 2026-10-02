import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Navbar from "../../components/Navbar";
import BridgeTransferStatus from "../../components/BridgeTransferStatus";
import BridgeFeeEstimate from "../../components/BridgeFeeEstimate";

export default function FundBridge() {
  const router = useRouter();
  const { jobId } = router.query;
  const [amount, setAmount] = useState("");
  const [evmChain, setEvmChain] = useState("ethereum");
  const [transferStatus, setTransferStatus] = useState<"idle" | "pending" | "confirming" | "complete" | "error">("idle");
  const [txHash, setTxHash] = useState("");
  const [confirmations, setConfirmations] = useState(0);
  const [requiredConfirmations] = useState(12);
  const [estimatedTime, setEstimatedTime] = useState("~2 minutes");
  const [error, setError] = useState("");

  const supportedChains = [
    { id: "ethereum", name: "Ethereum", confirmations: 12, estimatedMinutes: 2 },
    { id: "polygon", name: "Polygon", confirmations: 12, estimatedMinutes: 1 },
    { id: "arbitrum", name: "Arbitrum", confirmations: 12, estimatedMinutes: 1 },
    { id: "optimism", name: "Optimism", confirmations: 12, estimatedMinutes: 1 },
  ];

  const selectedChain = supportedChains.find((c) => c.id === evmChain) || supportedChains[0];

  useEffect(() => {
    if (transferStatus !== "confirming" || !txHash) return;

    const interval = setInterval(() => {
      setConfirmations((prev) => {
        if (prev >= requiredConfirmations) {
          clearInterval(interval);
          setTransferStatus("complete");
          return requiredConfirmations;
        }
        const next = prev + 1;
        if (next >= requiredConfirmations) {
          clearInterval(interval);
          setTransferStatus("complete");
        }
        return next;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [transferStatus, txHash, requiredConfirmations]);

  const handleFund = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }
    if (!jobId || typeof jobId !== "string") {
      setError("Missing job ID");
      return;
    }

    setError("");
    setTransferStatus("pending");

    try {
      const mockHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      await new Promise((resolve) => setTimeout(resolve, 1500));

      setTxHash(mockHash);
      setTransferStatus("confirming");
      setConfirmations(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to initiate bridge transfer");
      setTransferStatus("error");
    }
  };

  return (
    <div>
      <Head>
        <title>Fund Escrow via Bridge — MarketPay</title>
      </Head>
      <Navbar publicKey={null} onConnect={() => {}} onDisconnect={() => {}} />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">Fund Escrow via Bridge</h1>
        <p className="text-gray-600 mb-6">
          Deposit funds from an EVM chain. Your funds are locked in an EVM escrow
          contract and released to the Soroban marketplace only after confirmation.
        </p>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {transferStatus === "idle" && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">Amount</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border rounded-lg px-4 py-3"
                placeholder="0.00"
                step="0.0000001"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Source Chain</label>
              <select
                value={evmChain}
                onChange={(e) => setEvmChain(e.target.value)}
                className="w-full border rounded-lg px-4 py-3"
              >
                {supportedChains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </div>

            <BridgeFeeEstimate
              amount={amount}
              chain={evmChain}
              estimatedTime={`${selectedChain.estimatedMinutes} minute${selectedChain.estimatedMinutes > 1 ? "s" : ""}`}
            />

            <button
              onClick={handleFund}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700"
            >
              Continue to EVM Wallet
            </button>
          </div>
        )}

        {transferStatus === "confirming" && (
          <BridgeTransferStatus
            txHash={txHash}
            confirmations={confirmations}
            requiredConfirmations={requiredConfirmations}
            estimatedTime={estimatedTime}
          />
        )}

        {transferStatus === "complete" && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-green-800 mb-2">Deposit Confirmed!</h2>
            <p className="text-green-700">Your escrow has been funded. You can now start the hiring process.</p>
            <button
              onClick={() => router.push(`/jobs/${jobId}`)}
              className="mt-4 bg-green-600 text-white px-6 py-2 rounded-lg"
            >
              View Job
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
