@format-conversion
Feature: Format conversion on open and save

  Background:
    Given a fresh VS Code instance with the changedown extension activated

  @slow
  Scenario: L2 file auto-promotes to L3 on open
    Given a markdown file with L2 content containing inline CriticMarkup
    When I open the file
    Then the editor buffer contains L3 text with clean body
    And the footnote block has a [^cn-1]: line

  @slow
  Scenario: L3 buffer demotes to L2 on save
    Given the file from the previous scenario is open in L3 mode
    When I trigger a save
    Then the file on disk contains L2 inline CriticMarkup

  @pending
  Scenario: convertFormat rollback when replaceDocument rejects
    Given a markdown file with L2 content
    And the editor host is configured to reject replaceDocument
    When I open the file
    Then the editor buffer stays at L2
    And onDidConvertFormatError fires with the rejection error
