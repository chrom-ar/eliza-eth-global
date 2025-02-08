import { Coinbase, Wallet, ExternalAddress } from '@coinbase/coinbase-sdk';
import { CdpWalletProvider, CHAIN_ID_TO_NETWORK_ID } from '@coinbase/agentkit';

export const abi = [
  {
    "constant": true,
    "inputs": [
      {
        "name": "_owner",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "name": "balance",
        "type": "uint256"
      }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [
      {
        "name": "",
        "type": "uint8"
      }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
];


export const getWalletProvider = async (wallet: any): Promise<CdpWalletProvider> => {
  const networkId = await wallet.getNetworkId()
  const chainId = Object.keys(CHAIN_ID_TO_NETWORK_ID).find(
    k => CHAIN_ID_TO_NETWORK_ID[k] === networkId
  );
  const walletAddr = (await wallet.getDefaultAddress()).id

  // @ts-ignore
  return new CdpWalletProvider({
    wallet,
    address: walletAddr,
    network: {
      protocolFamily: "evm",
      chainId,
      networkId
    }
  });
}

export const sendTransaction = async (provider: CdpWalletProvider, transaction: any, waitForConfirmation: boolean  = true): Promise<object> => {
  const preparedTransaction = await provider.prepareTransaction(
    transaction.to,
    transaction.value,
    transaction.data
  )
  // @ts-ignore
  const signature = await provider.signTransaction({...preparedTransaction})
  const signedPayload = await provider.addSignatureAndSerialize(preparedTransaction, signature)
  const extAddr = new ExternalAddress(provider.getNetwork().networkId, provider.getAddress())
  const tx = await extAddr.broadcastExternalTransaction(signedPayload.slice(2))

  if (waitForConfirmation) {
    // @ts-ignore
    await provider.waitForTransactionReceipt(tx.transactionHash) // needed for sequential transactions
  }

  return tx
}

export const getBalance = async (provider: CdpWalletProvider, address: string, humanize: boolean = false): Promise<string | BigInt> => {
  const [bal, decimals] = (await Promise.all([
    provider.readContract({
      address: address as `0x${string}`,
      functionName: "balanceOf",
      args: [provider.getAddress()],
      // @ts-ignore
      abi
    }),
    provider.readContract({
      address: address as `0x${string}`,
      functionName: "decimals",
      args: [],
      // @ts-ignore
      abi
    })
  ])).map(v => Number(v))

  // @ts-ignore
  return humanize ? (bal / 10 ** decimals).toFixed(6) : bal
}
