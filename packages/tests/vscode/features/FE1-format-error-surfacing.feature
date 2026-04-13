@slow @FE1 @fixture(l3-promotion-test) @wip
Feature: FE1 — Format conversion error surfacing

  Regression gate for the onDidConvertFormatError subscription in extension.ts.
  When a format promotion fails, the extension must show a VS Code error toast
  containing "Format conversion failed" and leave the document in L2 (editable).

  Background:
    Given I open "l3-promotion-test.md" in VS Code
    And the ChangeDown extension is active
    And I wait for changes to load

  @FE1-01
  Scenario: FE1-01 Failed L2→L3 promotion shows an error notification
    # Demote back to L2 so the document is in a promotable state
    When I execute "changedown._testTriggerFormatConversionL2"
    And I wait 1000 milliseconds
    # Inject a one-shot promote failure — next convertFormat call will fire onDidConvertFormatError
    And I arm the format-conversion failure injection
    # Trigger promotion — the injected failure fires the error event
    And I execute "changedown._testTriggerFormatConversionL3"
    And I wait 1000 milliseconds
    # The extension.ts onDidConvertFormatError handler calls vscode.window.showErrorMessage
    Then an error message appears saying "Format conversion failed"

  @FE1-02
  Scenario: FE1-02 Document remains editable after failed promotion
    # Same setup as FE1-01 but focuses on the document state after rollback
    When I execute "changedown._testTriggerFormatConversionL2"
    And I wait 1000 milliseconds
    And I arm the format-conversion failure injection
    And I execute "changedown._testTriggerFormatConversionL3"
    And I wait 1000 milliseconds
    # Rollback leaves the document at L2 — CriticMarkup delimiters should still be present
    Then the document body contains CriticMarkup delimiters
