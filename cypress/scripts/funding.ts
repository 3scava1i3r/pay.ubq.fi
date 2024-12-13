/* eslint-disable sonarjs/no-duplicate-string */
import { SpawnSyncOptionsWithStringEncoding, spawnSync } from "child_process";
import { chainIdToRewardTokenMap } from "../../shared/constants";

/**
 * Handles the async funding of the testing environment
 * specifically for use within a GitHub Action.
 *
 * Attempts to make tests more reliable by ensuring that the
 * correct allowances and balances are set before running tests.
 *
 * Will attempt to retry a failed action up to 5 times max.
 */

class TestFunder {
  anvilRPC = "http://localhost:8545";
  fundingWallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  beneficiary = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  rewardToken = chainIdToRewardTokenMap[100];
  whale = "0xefC0e701A824943b469a694aC564Aa1efF7Ab7dd";
  expected = {
    allowance: "999999999999999111119999999999999999",
    balance: "10000000000000000000000",
  };

  async execute() {
    const loader = this.loader();

    let isMoving = true;

    const steps = {
      impersonate: async () => await this._impersonateAccount(this.whale),
      approveFunding: async () => await this._approvePayload(this.fundingWallet),
      transfer: async () => await this._transferPayload(),
    };

    while (isMoving) {
      console.log(`Attempting to fund the testing environment`);

      for (const [step, fn] of Object.entries(steps)) {
        console.log(`Running step: ${step}`);
        if (!(await fn())) {
          console.log(`Failed to run step: ${step} -> retrying...`);
          const isSuccess = await this.retry(fn);

          if (!isSuccess) {
            console.log(`Failed to run step: ${step} -> exiting...`);
            isMoving = false;
          }
        }
      }

      if (isMoving) {
        console.log(`Funding complete`);
        break;
      }
    }

    await this.validate();
    clearInterval(loader);
  }

  async retry(fn: () => Promise<boolean>, retries = 5) {
    let i = 0;
    let isSuccess = false;
    while (i < retries) {
      try {
        isSuccess = await fn();
      } catch (error) {
        console.error(error);
      }

      if (isSuccess) return isSuccess;
      i++;
    }
    throw new Error("Failed to execute function");
  }

  async validate() {
    const allowance = await this._fundingAllowanceCheck();
    const balance = await this._fundingBalanceCheck();

    if (parseInt(allowance) < parseInt(this.expected.allowance)) {
      throw new Error("Allowance is not set correctly");
    }

    if (parseInt(balance) < parseInt(this.expected.balance)) {
      throw new Error("Balance is not set correctly");
    }

    console.log(`Funding wallet is ready for testing\n`);
    console.log(`Allowance: ${allowance}\nBalance: ${balance}`);
  }

  private async _exec(payload: { command: string; args: string[]; options: SpawnSyncOptionsWithStringEncoding }) {
    const { command, args, options } = payload;
    const result = spawnSync(command, args, options);
    if (result.error) {
      throw result.error;
    }
    return result;
  }

  // pretend to be the whale
  private async _impersonateAccount(address: string) {
    const impersonate = await this._exec({
      command: "cast",
      args: ["rpc", "--rpc-url", this.anvilRPC, "anvil_impersonateAccount", address],
      options: { encoding: "utf8", stdio: "inherit" },
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    return impersonate.status === 0;
  }

  private async _fundingAllowanceCheck() {
    const allowance = await this._exec({
      command: "cast",
      args: ["call", this.rewardToken, "allowance(address,address)(uint256)", this.fundingWallet, this.permit2, "--rpc-url", this.anvilRPC],
      options: { encoding: "utf8" },
    });

    return allowance.stdout;
  }

  private async _fundingBalanceCheck() {
    const balance = await this._exec({
      command: "cast",
      args: ["call", this.rewardToken, "balanceOf(address)(uint256)", this.fundingWallet, "--rpc-url", this.anvilRPC],
      options: { encoding: "utf8" },
    });

    return balance.stdout;
  }

  private async _approvePayload(address: string) {
    const approve = await this._exec({
      command: "cast",
      args: [
        "send",
        "--rpc-url",
        this.anvilRPC,
        this.rewardToken,
        "--unlocked",
        "--from",
        address,
        "approve(address,uint256)(bool)",
        this.permit2,
        this.expected.allowance,
      ],
      options: { encoding: "utf8", stdio: "inherit" },
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    return approve.status === 0;
  }

  private async _transferPayload() {
    const balance = parseInt(await this._fundingBalanceCheck());
    const expected = parseInt(this.expected.balance);

    if (balance === expected) {
      return true;
    } else if (balance > expected) {
      await this.retry(() => this._clearBalance());
    }

    const transfer = await this._exec({
      command: "cast",
      args: [
        "send",
        "--rpc-url",
        this.anvilRPC,
        this.rewardToken,
        "--unlocked",
        "--from",
        this.whale,
        "transfer(address,uint256)(bool)",
        this.fundingWallet,
        this.expected.balance,
      ],
      options: { encoding: "utf8", stdio: "inherit" },
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    return transfer.status === 0;
  }

  private async _clearBalance() {
    console.log(`Funder was over-funded, clearing excess funds`);
    const balance = parseInt(await this._fundingBalanceCheck());
    const difference = BigInt(balance - parseInt(this.expected.balance));

    const clear = await this._exec({
      command: "cast",
      args: [
        "send",
        "--rpc-url",
        this.anvilRPC,
        this.rewardToken,
        "--unlocked",
        "--from",
        this.fundingWallet,
        "transfer(address,uint256)(bool)",
        this.whale,
        difference.toString(),
      ],
      options: { encoding: "utf8", stdio: "inherit" },
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    return clear.status === 0;
  }

  async pingAnvil() {
    try {
      const resp = await fetch("http://localhost:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "eth_blockNumber", params: [], id: 1, jsonrpc: "2.0" }),
      });

      const { result } = await resp.json();

      if (parseInt(result) > 0) {
        return true;
      }
    } catch {
      //
    }
    return false;
  }
  loader() {
    const steps = ["|", "/", "-", "\\"];
    let i = 0;
    return setInterval(() => {
      process.stdout.write(`\r${steps[i++]}`);
      i = i % steps.length;
    }, 100);
  }
}

async function main() {
  const funder = new TestFunder();
  let isAnvilReady = false;
  let retries = 5;

  while (!isAnvilReady && retries > 0) {
    isAnvilReady = await funder.pingAnvil();
    retries--;
    console.log(`Waiting for Anvil to ready up...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    if (retries === 0) {
      throw new Error(`Could not connect to Anvil`);
    }
  }

  await funder.execute();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
