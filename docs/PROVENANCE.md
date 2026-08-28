# Build Provenance

A deployed Soroban contract is a hash on the ledger. Without an attestation
there is nothing tying that hash to a reviewed commit in this repository, so
"which code is holding the escrowed funds?" is answered by trust rather than by
evidence.

[`.github/workflows/provenance.yml`](../.github/workflows/provenance.yml)
builds the contract from a tagged commit and signs a SLSA provenance statement
through GitHub's attestation service.

## What is attested

The statement binds together:

- the wasm artefact's SHA-256,
- the commit it was built from,
- the workflow and runner that built it,
- and a signature from GitHub's OIDC identity for this repository.

Before it builds, the workflow re-evaluates the policy set over the released
range. An attestation naming a commit that never passed the gate would be a
precise record of an unreviewed build, which is worse than none.

## Verifying a deployed contract

```bash
# Fetch the wasm you are about to trust, then:
gh attestation verify marketpay_contract.wasm --repo <owner>/Stellar-MarketPay
```

To check that a contract already on-chain matches:

```bash
stellar contract fetch --id <CONTRACT_ID> --network mainnet --out-file onchain.wasm
sha256sum onchain.wasm
gh attestation verify onchain.wasm --repo <owner>/Stellar-MarketPay
```

A mismatch means the deployed contract was not built by this workflow from this
repository. That is an incident, not a discrepancy.

## Producing one

Provenance is generated automatically for any `v*` tag. To attest a specific
commit:

```
Actions → Release Provenance → Run workflow → ref: <tag or sha>
```

The job summary prints the commit, the wasm digest and the verification
command, so a deployment record can quote all three.

## What provenance does not give you

It proves an artefact came from a particular commit through a particular
workflow. It does not prove the code is correct, that the review was
meaningful, or that the deployer deployed the artefact they verified. It closes
one gap — an artefact of unknown origin — and it is only as strong as the
commit history underneath it, which is why it is paired with
[commit signing](COMMIT_SIGNING.md) and with a policy gate that cannot be
bypassed.
