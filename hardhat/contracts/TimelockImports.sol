// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Ce fichier force la compilation de TimelockController, utilisé
// uniquement via Ignition (ignition/modules/CryptoPixel.ts), jamais
// hérité directement par CryptoPixel.sol.
import "@openzeppelin/contracts/governance/TimelockController.sol";

// La déclaration ci-dessous (même vide) force Hardhat 3 à matérialiser
// un artifact JSON pour TimelockController, ce qu'un simple import seul
// ne suffit pas à faire dans ce compilateur.
contract TimelockControllerImport is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}