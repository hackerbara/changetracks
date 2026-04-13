@slow @D-lsp-disconnected @fixture(decoration-baseline-matrix)
Feature: Rendering works with LSP disconnected (hybrid mode)
  With LocalParseAdapter wired in, decorations should render from local parse
  even when the LSP server is stopped. This is the regression gate for Shift 4.

  Background:
    Given I open "decoration-baseline-matrix.md" in VS Code
    And the ChangeDown extension is active
    And I wait for changes to load

  Scenario: Decorations are present before LSP is disconnected
    Then inline decorations are visible

  Scenario: Decorations render in simple view with LSP disconnected
    When I disconnect the LSP server
    And I switch to "simple" view mode
    Then inline decorations are visible

  Scenario: Decorations render in all-markup view with LSP disconnected
    When I disconnect the LSP server
    And I switch to "all-markup" view mode
    Then inline decorations are visible

  Scenario: LSP client can be stopped and verified as not running
    When I disconnect the LSP server
    Then the LSP client is not running after disconnect
