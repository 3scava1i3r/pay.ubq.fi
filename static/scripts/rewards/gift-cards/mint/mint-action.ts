import { ethers } from "ethers";
import { giftCardTreasuryAddress, permit2Address } from "../../../../../shared/constants";
import { isClaimableForAmount } from "../../../../../shared/pricing";
import { GiftCard } from "../../../../../shared/types";
import { permit2Abi } from "../../abis";
import { AppState } from "../../app-state";
import { isErc20Permit } from "../../render-transaction/render-transaction";
import { toaster } from "../../toaster";
import { checkPermitClaimable, transferFromPermit, waitForTransaction } from "../../web3/erc20-permit";
import { getApiBaseUrl, getUserCountryCode } from "../helpers";
import { initClaimGiftCard } from "../index";
import { getGiftCardOrderId } from "../../../../../shared/helpers";
import { postOrder } from "../../../shared/api";

export function attachMintAction(giftCard: GiftCard, app: AppState) {
  const mintBtn: HTMLElement | null = document.getElementById("mint");

  mintBtn?.addEventListener("click", async () => {
    mintBtn.setAttribute("data-loading", "true");
    const productId = Number(document.getElementById("offered-card")?.getAttribute("data-product-id"));

    if (!isErc20Permit(app.reward)) {
      toaster.create("error", "Only ERC20 permits are allowed to claim a card.");
    } else if (!isClaimableForAmount(giftCard, app.reward.amount)) {
      toaster.create("error", "Your reward amount is not equal to the price of available card.");
    } else {
      await mintGiftCard(productId, app);
    }

    mintBtn.setAttribute("data-loading", "false");
  });
}

async function mintGiftCard(productId: number, app: AppState) {
  if (!app.signer) {
    toaster.create("error", "Connect your wallet.");
    return;
  }
  const country = await getUserCountryCode();
  if (!country) {
    toaster.create("error", "Failed to detect your location to pick a suitable card for you.");
    return;
  }

  const txHash = getIncompleteClaimTx(app.reward.nonce) || (await claimPermitToCardTreasury(app));

  if (txHash) {
    const order = await postOrder({
      type: "permit",
      chainId: app.signer.provider.network.chainId,
      txHash: txHash,
      productId,
      country: country,
    });
    if (!order) {
      toaster.create("error", "Order failed. Try again in a few minutes.");
      return;
    }
    await checkForMintingDelay(app);
  } else {
    toaster.create("error", "Card minting failed. Try again in a few minutes.");
  }
}

async function checkForMintingDelay(app: AppState) {
  if (await hasMintingFinished(app)) {
    removeIncompleteClaimTx(app.reward.nonce);
    await initClaimGiftCard(app);
  } else {
    const interval = setInterval(async () => {
      if (await hasMintingFinished(app)) {
        clearInterval(interval);
        await initClaimGiftCard(app);
      } else {
        toaster.create("info", "Minting is in progress. Please wait...");
      }
    }, 10000);
    toaster.create("info", "Minting is in progress. Please wait...");
  }
}

async function claimPermitToCardTreasury(app: AppState) {
  if (!app.signer) {
    toaster.create("error", "Connect your wallet.");
    return;
  }
  const isClaimable = await checkPermitClaimable(app);
  if (isClaimable) {
    const permit2Contract = new ethers.Contract(permit2Address, permit2Abi, app.signer);
    if (!permit2Contract) return;

    const reward = {
      ...app.reward,
    };
    reward.beneficiary = giftCardTreasuryAddress;

    const tx = await transferFromPermit(permit2Contract, reward, "Processing... Please wait. Do not close this page.");
    if (!tx) return;

    storeIncompleteClaimTx(app.reward.nonce, tx.hash);
    await waitForTransaction(tx, `Transaction confirmed. Minting your card now.`, app.signer.provider.network.chainId);
    return tx.hash;
  } else {
    toaster.create("error", "Connect your wallet to proceed.");
  }
}

async function hasMintingFinished(app: AppState): Promise<boolean> {
  const retrieveOrderUrl = `${getApiBaseUrl()}/get-order?orderId=${getGiftCardOrderId(app.reward.beneficiary, app.reward.signature)}`;
  const orderResponse = await fetch(retrieveOrderUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  return orderResponse.status != 404;
}

const storageKey = "incompleteClaims";

function getIncompleteClaimTx(permitNonce: string): string | null {
  const incompleteClaims = localStorage.getItem(storageKey);
  return incompleteClaims ? JSON.parse(incompleteClaims)[permitNonce] : null;
}

function storeIncompleteClaimTx(permitNonce: string, txHash: string) {
  let incompleteClaims: { [key: string]: string } = { [permitNonce]: txHash };
  const oldIncompleteClaims = localStorage.getItem(storageKey);
  if (oldIncompleteClaims) {
    incompleteClaims = { ...incompleteClaims, ...JSON.parse(oldIncompleteClaims) };
  }
  localStorage.setItem(storageKey, JSON.stringify(incompleteClaims));
}

function removeIncompleteClaimTx(permitNonce: string) {
  const incompleteClaims = localStorage.getItem(storageKey);
  if (incompleteClaims) {
    const incompleteClaimsObj = JSON.parse(incompleteClaims);
    delete incompleteClaimsObj[permitNonce];
    localStorage.setItem(storageKey, JSON.stringify(incompleteClaimsObj));
  }
}
