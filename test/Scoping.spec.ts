import { expect } from "chai";
import hre, { deployments, waffle, ethers } from "hardhat";
import "@nomiclabs/hardhat-ethers";

const COMP_EQUAL = 0;
const COMP_GREATER = 1;
const COMP_LESS = 2;
const COMP_ONE_OF = 3;

describe("Scoping", async () => {
  const baseSetup = deployments.createFixture(async () => {
    await deployments.fixture();
    const Avatar = await hre.ethers.getContractFactory("TestAvatar");
    const avatar = await Avatar.deploy();
    const TestContract = await hre.ethers.getContractFactory("TestContract");
    const testContract = await TestContract.deploy();
    const testContractClone = await TestContract.deploy();
    return { Avatar, avatar, testContract, testContractClone };
  });

  const setupRolesWithOwnerAndInvoker = deployments.createFixture(async () => {
    const base = await baseSetup();

    const [owner, invoker] = waffle.provider.getWallets();

    const Permissions = await hre.ethers.getContractFactory("Permissions");
    const permissions = await Permissions.deploy();
    const Modifier = await hre.ethers.getContractFactory("Roles", {
      libraries: {
        Permissions: permissions.address,
      },
    });

    const modifier = await Modifier.deploy(
      owner.address,
      base.avatar.address,
      base.avatar.address
    );

    await modifier.enableModule(invoker.address);

    return {
      ...base,
      Modifier,
      modifier,
      owner,
      invoker,
    };
  });

  it("scoping one param should work", async () => {
    const { modifier, testContract, owner, invoker } =
      await setupRolesWithOwnerAndInvoker();

    const ROLE_ID = 0;
    const SELECTOR = testContract.interface.getSighash(
      testContract.interface.getFunction("fnWithThreeParams")
    );

    await modifier
      .connect(owner)
      .assignRoles(invoker.address, [ROLE_ID], [true]);

    const { data: dataFail } =
      await testContract.populateTransaction.fnWithThreeParams(1, 2, 3);

    const { data: dataOk } =
      await testContract.populateTransaction.fnWithThreeParams(1, 4, 3);

    await modifier
      .connect(owner)
      .allowTargetPartially(ROLE_ID, testContract.address, false, false);

    await modifier
      .connect(owner)
      .scopeAllowFunction(ROLE_ID, testContract.address, SELECTOR);

    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(testContract.address, 0, dataFail, 0)
    ).to.not.be.reverted;

    await modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        1,
        false,
        COMP_EQUAL,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [4])
      );

    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(testContract.address, 0, dataFail, 0)
    ).to.be.revertedWith("ParameterNotAllowed()");

    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(testContract.address, 0, dataOk, 0)
    ).to.not.be.reverted;
  });

  it("unscoping one param should work", async () => {
    const { modifier, testContract, owner, invoker } =
      await setupRolesWithOwnerAndInvoker();

    const ROLE_ID = 0;
    const SELECTOR = testContract.interface.getSighash(
      testContract.interface.getFunction("fnWithThreeParams")
    );

    await modifier
      .connect(owner)
      .assignRoles(invoker.address, [ROLE_ID], [true]);

    await modifier
      .connect(owner)
      .allowTargetPartially(ROLE_ID, testContract.address, false, false);

    await modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        0,
        false,
        COMP_EQUAL,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [4])
      );

    await modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        1,
        false,
        COMP_EQUAL,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [5])
      );

    const { data: dataFail } =
      await testContract.populateTransaction.fnWithThreeParams(4, 2, 3);
    const { data: dataOk } =
      await testContract.populateTransaction.fnWithThreeParams(4, 5, 3);

    // fails first
    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(testContract.address, 0, dataFail, 0)
    ).to.be.revertedWith("ParameterNotAllowed()");

    // sanity check
    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(testContract.address, 0, dataOk, 0)
    ).to.not.be.reverted;

    await modifier
      .connect(owner)
      .unscopeParameter(ROLE_ID, testContract.address, SELECTOR, 1);

    // works after unscoping
    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(testContract.address, 0, dataFail, 0)
    ).to.not.be.reverted;
  });

  it("scoping one param should work after allow function", async () => {
    const { modifier, testContract, owner, invoker } =
      await setupRolesWithOwnerAndInvoker();

    const ROLE_ID = 0;
    const SELECTOR = testContract.interface.getSighash(
      testContract.interface.getFunction("fnWithThreeParams")
    );

    await modifier
      .connect(owner)
      .assignRoles(invoker.address, [ROLE_ID], [true]);

    await modifier
      .connect(owner)
      .allowTargetPartially(ROLE_ID, testContract.address, false, false);

    // this call is supposed to be redudant. This test is checking that scoping one para after scoping all works
    await modifier
      .connect(owner)
      .scopeAllowFunction(ROLE_ID, testContract.address, SELECTOR);

    await modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        0,
        false,
        COMP_EQUAL,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [7])
      );

    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (
            await testContract.populateTransaction.fnWithThreeParams(1, 2, 3)
          ).data,
          0
        )
    ).to.be.revertedWith("ParameterNotAllowed()");

    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (
            await testContract.populateTransaction.fnWithThreeParams(7, 2, 3)
          ).data,
          0
        )
    ).to.not.be.reverted;
  });

  it("scoping one param should work after scope function", async () => {
    const { modifier, testContract, owner, invoker } =
      await setupRolesWithOwnerAndInvoker();

    const ROLE_ID = 0;
    const SELECTOR = testContract.interface.getSighash(
      testContract.interface.getFunction("fnWithThreeParams")
    );

    await modifier
      .connect(owner)
      .assignRoles(invoker.address, [ROLE_ID], [true]);

    const { data: dataFail } =
      await testContract.populateTransaction.fnWithThreeParams(1, 2, 3);
    const { data: dataOk } =
      await testContract.populateTransaction.fnWithThreeParams(1, 7, 3);

    await modifier
      .connect(owner)
      .allowTargetPartially(ROLE_ID, testContract.address, false, false);

    await modifier
      .connect(owner)
      .scopeFunction(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        [false, true, false],
        [false, false, false],
        [COMP_EQUAL, COMP_EQUAL, COMP_EQUAL],
        ["0x", ethers.utils.defaultAbiCoder.encode(["uint256"], [7]), "0x"]
      );

    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(testContract.address, 0, dataFail, 0)
    ).to.be.revertedWith("ParameterNotAllowed()");

    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(testContract.address, 0, dataOk, 0)
    ).to.not.be.reverted;

    // set last param also as scoped
    await modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        2,
        false,
        COMP_EQUAL,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [8])
      );

    // should account for last param
    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (
            await testContract.populateTransaction.fnWithThreeParams(1, 7, 3)
          ).data,
          0
        )
    ).to.be.revertedWith("ParameterNotAllowed()");
    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (
            await testContract.populateTransaction.fnWithThreeParams(1, 2, 8)
          ).data,
          0
        )
    ).to.be.revertedWith("ParameterNotAllowed()");
    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (
            await testContract.populateTransaction.fnWithThreeParams(1, 7, 8)
          ).data,
          0
        )
    ).to.not.be.reverted;
  });

  it("function scoping all params off, should result in FunctionNotAllowed", async () => {
    const { modifier, testContract, owner, invoker } =
      await setupRolesWithOwnerAndInvoker();

    const ROLE_ID = 0;
    const SELECTOR = testContract.interface.getSighash(
      testContract.interface.getFunction("fnWithThreeParams")
    );

    await modifier
      .connect(owner)
      .assignRoles(invoker.address, [ROLE_ID], [true]);

    await modifier
      .connect(owner)
      .allowTargetPartially(ROLE_ID, testContract.address, false, false);

    await modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        0,
        false,
        COMP_EQUAL,
        "0x"
      );

    await modifier
      .connect(owner)
      .scopeFunction(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        [false, false, false],
        [false, false, false],
        [0, 0, 0],
        ["0x", "0x", "0x"]
      );

    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (
            await testContract.populateTransaction.fnWithThreeParams(1, 2, 3)
          ).data,
          0
        )
    ).to.be.revertedWith("FunctionNotAllowed()");
  });

  it("unscoping all params one by one, should result in FunctionNotAllowed", async () => {
    const { modifier, testContract, owner, invoker } =
      await setupRolesWithOwnerAndInvoker();

    const ROLE_ID = 0;
    const SELECTOR = testContract.interface.getSighash(
      testContract.interface.getFunction("fnWithThreeParams")
    );

    await modifier
      .connect(owner)
      .assignRoles(invoker.address, [ROLE_ID], [true]);

    await modifier
      .connect(owner)
      .allowTargetPartially(ROLE_ID, testContract.address, false, false);

    await modifier
      .connect(owner)
      .scopeFunction(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        [true, true, false],
        [false, false, false],
        [0, 0, 0],
        ["0x", "0x", "0x"]
      );

    await modifier
      .connect(owner)
      .unscopeParameter(ROLE_ID, testContract.address, SELECTOR, 0);

    //if some params still scoped returned ParamNotAllowed
    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (
            await testContract.populateTransaction.fnWithThreeParams(1, 2, 3)
          ).data,
          0
        )
    ).to.be.revertedWith("ParameterNotAllowed()");

    await modifier
      .connect(owner)
      .unscopeParameter(ROLE_ID, testContract.address, SELECTOR, 1);

    //all params off -> FunctionNotAllowed
    await expect(
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (
            await testContract.populateTransaction.fnWithThreeParams(1, 2, 3)
          ).data,
          0
        )
    ).to.be.revertedWith("FunctionNotAllowed()");
  });

  it("update compType should work on already scoped parameter", async () => {
    const { modifier, testContract, owner, invoker } =
      await setupRolesWithOwnerAndInvoker();
    const ROLE_ID = 0;
    const SELECTOR = testContract.interface.getSighash(
      testContract.interface.getFunction("fnWithSingleParam")
    );
    await modifier
      .connect(owner)
      .assignRoles(invoker.address, [ROLE_ID], [true]);

    await modifier
      .connect(owner)
      .allowTargetPartially(ROLE_ID, testContract.address, false, false);

    await modifier
      .connect(owner)
      .scopeAllowFunction(ROLE_ID, testContract.address, SELECTOR);

    const invoke = async (param: number) =>
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (await testContract.populateTransaction.fnWithSingleParam(param))
            .data,
          0
        );

    // sanity
    await expect(invoke(2021)).to.not.be.reverted;

    modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        0,
        false,
        COMP_LESS,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [420])
      );

    await expect(invoke(421)).to.be.revertedWith(
      "ParameterGreaterThanAllowed()"
    );
    await expect(invoke(419)).to.not.be.reverted;

    // FLIP THE SAME PARAM to greater
    modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        0,
        false,
        COMP_GREATER,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [420])
      );

    await expect(invoke(421)).to.not.be.reverted;
    await expect(invoke(419)).to.be.revertedWith("ParameterLessThanAllowed()");
  });

  it("scoping a high parameter index, after a lower one should work", async () => {
    const { modifier, testContract, owner, invoker } =
      await setupRolesWithOwnerAndInvoker();

    const ROLE_ID = 0;
    const IS_DYNAMIC = true;
    const SELECTOR = testContract.interface.getSighash(
      testContract.interface.getFunction("fnWithThreeParams")
    );

    const invoke = async (a: number, b: number, c: number) =>
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (await testContract.populateTransaction.fnWithThreeParams(a, b, c))
            .data,
          0
        );

    await modifier
      .connect(owner)
      .assignRoles(invoker.address, [ROLE_ID], [true]);

    await modifier
      .connect(owner)
      .allowTargetPartially(ROLE_ID, testContract.address, false, false);

    await modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        0,
        !IS_DYNAMIC,
        COMP_EQUAL,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [1])
      );

    await expect(invoke(1, 3, 2021)).to.not.be.reverted;

    await modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        1,
        !IS_DYNAMIC,
        COMP_EQUAL,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [2])
      );
    await expect(invoke(1, 3, 2021)).to.be.revertedWith(
      "ParameterNotAllowed()"
    );

    await expect(invoke(1, 2, 3000)).to.not.be.reverted;
  });

  it("scoping a low parameter index, after a higher one should work", async () => {
    const { modifier, testContract, owner, invoker } =
      await setupRolesWithOwnerAndInvoker();

    const ROLE_ID = 0;
    const IS_DYNAMIC = true;
    const SELECTOR = testContract.interface.getSighash(
      testContract.interface.getFunction("fnWithThreeParams")
    );

    const invoke = async (a: number, b: number, c: number) =>
      modifier
        .connect(invoker)
        .execTransactionFromModule(
          testContract.address,
          0,
          (await testContract.populateTransaction.fnWithThreeParams(a, b, c))
            .data,
          0
        );

    await modifier
      .connect(owner)
      .assignRoles(invoker.address, [ROLE_ID], [true]);

    await modifier
      .connect(owner)
      .allowTargetPartially(ROLE_ID, testContract.address, false, false);

    await modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        2,
        !IS_DYNAMIC,
        COMP_EQUAL,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [3])
      );

    await expect(invoke(2000, 3000, 3)).to.not.be.reverted;

    await modifier
      .connect(owner)
      .scopeParameter(
        ROLE_ID,
        testContract.address,
        SELECTOR,
        0,
        !IS_DYNAMIC,
        COMP_EQUAL,
        ethers.utils.defaultAbiCoder.encode(["uint256"], [1])
      );
    await expect(invoke(2000, 3000, 3)).to.be.revertedWith(
      "ParameterNotAllowed()"
    );

    await expect(invoke(1, 3000, 3)).to.not.be.reverted;
  });
});