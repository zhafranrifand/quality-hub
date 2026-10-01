@lokasi @smoke
Feature: LOKASI Intelligence workflows
  As a LOKASI user
  I want core Intelligence workflows to behave predictably
  So that I can explore data and configure analysis with confidence

  @qh_key_lokasi_auth_empty_email @TC-34058CA9 @authentication
  Scenario: Continue is disabled without an email
    When I open the LOKASI sign-in page
    Then Continue is disabled and password recovery is available

  @qh_key_lokasi_auth_phone_layout @TC-8EAA122C @responsive
  Scenario: Sign-in entry point works on a phone-sized screen
    When I open the sign-in page on a 390 pixel viewport
    Then the sign-in controls fit without horizontal overflow

  @qh_key_lokasi_auth_known_account @TC-002C118E @authentication
  Scenario: Known account advances from email to password
    When I open the LOKASI sign-in page
    And I continue with the configured account email
    Then the password entry is displayed

  @qh_key_lokasi_navigation_modules @TC-081C91EF @navigation
  Scenario: Authorized account opens Intelligence modules
    And I am signed in to the LOKASI workspace
    When I open each primary Intelligence module
    Then each module loads inside the Intelligence workspace

  @qh_key_lokasi_search_place @TC-F827F2E5 @search
  Scenario: Searching for a place selects it on the map
    And I am signed in to the LOKASI workspace
    When I search for Jakarta International Stadium
    Then the selected place is marked on the map

  @qh_key_lokasi_partner_dataset @TC-B61A7B5F @datasets
  Scenario: Partner dataset can be selected and previewed
    And I am signed in to the LOKASI workspace
    When I open Dataset Explorer and preview the Jakarta partner dataset
    Then its provider, sample rows, and search control are visible

  @qh_key_lokasi_dataset_preview_filter @datasets @filtering
  Scenario: Dataset preview filtering narrows and restores rows
    And I am signed in to the LOKASI workspace
    When I preview the Jakarta partner dataset
    Then filtering the preview and clearing the filter restores the sample rows

  @qh_key_lokasi_analysis_invalid_area @TC-0DDFEF0E @analysis
  Scenario: Analysis requires a valid filter area
    And I am signed in to the LOKASI workspace
    When I open analysis and leave the filter area invalid
    Then Save remains disabled
