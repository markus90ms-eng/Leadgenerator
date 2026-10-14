"""Branchen-Einteilung in zwei Ebenen (Hauptbranche -> Unterbranche).

Jede Unterbranche hat
  - "weight": Grund-Werbepotenzial (0-40) für Außenwerbung / DOOH,
  - "osm":    OpenStreetMap-Filter [(Key, Regex für Werte[, {Zusatz-Key: Regex}])],
  - "ov":     Kategorien der Overture-Maps-Taxonomie (Blatt oder Oberbegriff).

Ein Betrieb landet in der ersten passenden Unterbranche; Sammelbranchen
("fallback") werden zuletzt geprüft.
"""

import re

GROUPS = [
    ("bau", "Bau & Handwerk"),
    ("auto", "Auto & Mobilität"),
    ("wohnen", "Wohnen & Einrichtung"),
    ("gastro", "Gastronomie"),
    ("hotel", "Hotels & Unterkünfte"),
    ("mode", "Mode & Lifestyle"),
    ("lebensmittel", "Lebensmittel & Getränke"),
    ("beauty", "Beauty & Wellness"),
    ("sport", "Fitness & Sport"),
    ("technik", "Elektronik & Technik"),
    ("handel", "Weitere Händler"),
    ("baumarkt", "Bau-, Garten- & Fachhandel"),
    ("immobilien", "Immobilien"),
    ("dienst", "Dienstleister & B2B"),
    ("bildung", "Bildung"),
    ("freizeit", "Freizeit & Events"),
    ("gesundheit", "Gesundheit & Pflege"),
    ("finanzen", "Banken & Versicherungen"),
    ("recht", "Recht & Steuern"),
]

PRIVATE = {"operator:type": "^(private|privat)$"}

# (id, Name, Gruppe, Gewicht, OSM-Filter, Overture-Kategorien[, fallback])
_CATEGORIES = [
    # ---- Bau & Handwerk
    ("sanitaer", "Bad, Sanitär & Heizung", "bau", 32,
     [("craft", "^(plumber|hvac|heating_engineer|sanitary|sanitary_engineer|installer)$")],
     ["plumbing", "hvac_service", "bathroom_remodeling", "fireplace_service", "hvac_supplier", "chimney_service"]),
    ("elektro", "Elektro, Solar & Sicherheitstechnik", "bau", 30,
     [("craft", "^(electrician|photovoltaic|solar|electrical_engineer)$")],
     ["electrician", "solar_installation", "security_systems", "home_security", "elevator_service"]),
    ("maler", "Maler, Stuckateur & Trockenbau", "bau", 28,
     [("craft", "^(painter|plasterer|stuccoer|drywall|decorator)$")],
     ["painting", "stucco_service", "plasterer", "drywall_service"]),
    ("dach", "Dach, Zimmerei & Gerüstbau", "bau", 30,
     [("craft", "^(roofer|carpenter|scaffolder|insulation|tinsmith|plumber_roof)$")],
     ["roofing", "ceiling_and_roofing_repair_and_service"]),
    ("schreiner", "Schreinerei & Innenausbau", "bau", 30,
     [("craft", "^(joiner|cabinet_maker|parquet_layer|interior_work|turner|woodworker)$")],
     ["carpenter", "cabinet_sales_service", "countertop_installation", "furniture_manufacturer", "furniture_assembly"]),
    ("boden", "Fliesen, Boden & Naturstein", "bau", 28,
     [("craft", "^(tiler|floorer|stonemason|screed_layer)$")],
     ["flooring_contractor", "tiling", "masonry_concrete", "stone_and_masonry", "granite_supplier", "stone_supplier"]),
    ("metallbau", "Fenster, Türen, Metallbau & Glas", "bau", 30,
     [("craft", "^(window_construction|metal_construction|glaziery|locksmith|blacksmith|key_cutter|door_construction|shutter)$")],
     ["windows_installation", "window_supplier", "door_sales_service", "garage_door_service", "glass_and_mirror_sales_service",
      "fence_and_gate_sales_service", "key_and_locksmith", "welder", "metal_fabricator", "blacksmith", "awning_supplier",
      "home_window_tinting"]),
    ("galabau", "Garten- & Landschaftsbau", "bau", 28,
     [("craft", "^(gardener|landscape_gardener|landscaper)$")],
     ["gardener", "landscaping", "landscape_architect", "tree_service", "pool_cleaning"]),
    ("bauunternehmen", "Bauunternehmen & Tiefbau", "bau", 34,
     [("office", "^(construction_company)$"), ("craft", "^(builder|bricklayer|concrete|road_construction)$")],
     ["contractor", "building_contractor", "road_contractor", "masonry_contractor", "excavation_service",
      "demolition_service", "crane_service", "well_drilling", "building_or_construction_service"]),
    ("handwerk", "Sonstiges Handwerk", "bau", 24,
     [("craft", ".")],
     ["home_service", "handyman", "chimney_sweep", "pest_control_service", "sewing_and_alterations", "tailor",
      "shoe_repair", "appliance_repair_service", "knife_sharpening", "fire_protection_service",
      "fire_and_water_damage_restoration", "damage_restoration"], True),

    # ---- Auto & Mobilität
    ("autohaus", "Autohaus", "auto", 40,
     [("shop", "^(car|truck)$")],
     ["auto_dealer", "used_auto_dealer", "vehicle_dealer", "truck_dealer", "auto_broker", "trailer_dealer", "forklift_dealer"]),
    ("werkstatt", "Kfz-Werkstatt & Service", "auto", 32,
     [("shop", "^(car_repair)$"), ("craft", "^(car_repair|car_painter)$")],
     ["automotive_repair", "automotive_service", "auto_body_shop", "auto_glass_service", "auto_detailing", "car_inspection",
      "towing_service", "truck_repair", "auto_customization", "auto_restoration_service", "auto_upholstery",
      "emissions_inspection", "mobile_dent_repair", "automobile_registration_service"]),
    ("reifen", "Reifen & Autoteile", "auto", 30,
     [("shop", "^(tyres|car_parts)$")],
     ["tire_shop", "tire_dealer_and_repair", "auto_parts_store", "vehicle_parts_store"]),
    ("motorrad", "Motorrad, Wohnmobil & Boote", "auto", 32,
     [("shop", "^(motorcycle|motorcycle_repair|caravan|boat|atv)$")],
     ["motorcycle_dealer", "motorcycle_repair", "motorcycle_parts_store", "motorsports_store", "recreational_vehicle_dealer",
      "recreation_vehicle_repair", "boat_dealer"]),
    ("vermietung", "Autovermietung & Carsharing", "auto", 26,
     [("amenity", "^(car_rental|car_sharing|vehicle_rental)$")],
     ["car_rental_service", "vehicle_rental_service", "trailer_rental_service", "rv_rental_service", "car_sharing"]),
    ("fahrschule", "Fahrschule", "auto", 32,
     [("amenity", "^(driving_school)$"), ("shop", "^(driving_school)$")],
     ["driving_school", "flight_school"]),
    ("tankstelle", "Tankstelle & Waschanlage", "auto", 16,
     [("amenity", "^(fuel|car_wash)$")],
     ["gas_station", "truck_gas_station", "car_wash"]),
    ("taxi", "Taxi & Personenbeförderung", "auto", 20,
     [("office", "^(taxi)$"), ("amenity", "^(taxi_office)$")],
     ["taxi_service", "limo_service", "airport_shuttle", "bus_tour"]),

    # ---- Wohnen & Einrichtung
    ("moebel", "Möbel & Wohnaccessoires", "wohnen", 38,
     [("shop", "^(furniture|interior_decoration|bed|curtain|houseware|carpet|furnace|antiques)$")],
     ["furniture_store", "home_goods_store", "home_decor_store", "mattress_store", "carpet_store", "linen_store",
      "bedding_and_bath_store", "window_treatment_store", "outdoor_furniture_store", "candle_store"]),
    ("kuechen", "Küchen & Badausstellung", "wohnen", 38,
     [("shop", "^(kitchen|bathroom_furnishing|bathroom)$")],
     ["kitchen_and_bath_store", "kitchen_remodeling", "kitchen_supply_store"]),
    ("leuchten", "Leuchten & Haushaltsgeräte", "wohnen", 30,
     [("shop", "^(lighting|appliance|electrical)$")],
     ["lighting_store", "appliance_store"]),
    ("raumausstatter", "Raumausstatter & Bodenbeläge", "wohnen", 30,
     [("shop", "^(flooring|tiles)$"), ("craft", "^(upholsterer|interior_decorator)$")],
     ["flooring_store", "tile_store", "furniture_reupholstery", "interior_design"]),

    # ---- Gastronomie
    ("imbiss", "Imbiss, Döner & Lieferdienst", "gastro", 28,
     [("amenity", "^(fast_food|food_court)$")],
     ["fast_food_restaurant", "doner_kebab_restaurant", "food_truck_stand", "pizza_delivery_service", "food_delivery_service",
      "sandwich_shop", "falafel_restaurant", "chicken_restaurant", "burger_restaurant"]),
    ("biergarten", "Biergarten & Besenwirtschaft", "gastro", 28,
     [("amenity", "^(biergarten)$")],
     ["beer_garden"]),
    ("bar", "Bar, Kneipe & Club", "gastro", 30,
     [("amenity", "^(bar|pub|nightclub|stripclub|hookah_lounge)$")],
     ["bar", "pub", "lounge", "nightlife_venue", "dance_club", "hookah_bar", "wine_bar", "cocktail_bar", "sports_bar",
      "beer_bar", "speakeasy", "dive_bar"]),
    ("cafe", "Café & Konditorei", "gastro", 30,
     [("amenity", "^(cafe)$"), ("shop", "^(pastry|coffee)$")],
     ["cafe", "coffee_shop", "tea_room", "patisserie_cake_shop", "custom_cakes_shop", "bubble_tea_shop", "coffee_roastery",
      "internet_cafe", "smoothie_juice_bar", "non_alcoholic_beverage_venue"]),
    ("eis", "Eisdiele", "gastro", 26,
     [("amenity", "^(ice_cream)$"), ("shop", "^(ice_cream)$")],
     ["ice_cream_shop", "gelato_shop", "dessert_shop", "donut_shop"]),
    ("catering", "Catering & Partyservice", "gastro", 28,
     [("craft", "^(caterer)$"), ("shop", "^(catering)$")],
     ["caterer"]),
    ("restaurant", "Restaurant", "gastro", 30,
     [("amenity", "^(restaurant)$")],
     ["restaurant", "casual_eatery", "food_and_drink", "bistro", "gastropub", "diner", "tapas_bar", "cafeteria"]),

    # ---- Hotels & Unterkünfte
    ("hotel", "Hotel & Gasthof", "hotel", 30,
     [("tourism", "^(hotel|motel)$")],
     ["hotel", "inn", "motel", "resort", "lodge", "ski_resort"]),
    ("pension", "Pension & Ferienwohnung", "hotel", 22,
     [("tourism", "^(guest_house|apartment|chalet|hostel)$")],
     ["bed_and_breakfast", "guest_house", "holiday_rental_home", "hostel", "service_apartment", "cottage", "cabin",
      "self_catering_accommodation", "private_lodging", "lodging", "agritourism"]),
    ("camping", "Camping", "hotel", 22,
     [("tourism", "^(camp_site|caravan_site)$")],
     ["campground", "rv_park"]),

    # ---- Mode & Lifestyle
    ("schmuck", "Schmuck & Uhren", "mode", 32,
     [("shop", "^(jewelry|watches)$"), ("craft", "^(goldsmith|jeweller|watchmaker)$")],
     ["jewelry_store", "watch_store", "goldsmith", "jewelry_manufacturer", "jewelry_and_watches_manufacturer"]),
    ("optiker", "Optiker & Hörakustik", "mode", 32,
     [("shop", "^(optician|hearing_aids)$"), ("healthcare", "^(optometrist|audiologist)$")],
     ["eyewear_store", "sunglasses_store", "hearing_aid_store", "optometry", "audiology"]),
    ("schuhe", "Schuhe & Taschen", "mode", 30,
     [("shop", "^(shoes|bag|leather|fashion_accessories)$")],
     ["shoe_store", "orthopedic_shoe_store", "leather_goods_store", "luggage_store", "handbag_store",
      "fashion_accessories_store", "hat_store"]),
    ("parfuemerie", "Parfümerie & Kosmetikartikel", "mode", 28,
     [("shop", "^(perfumery|cosmetics|beauty_supply)$")],
     ["cosmetics_and_fragrance_store", "beauty_supply_store", "hair_supply_store", "wig_store"]),
    ("bekleidung", "Bekleidung & Boutique", "mode", 32,
     [("shop", "^(clothes|boutique|fashion|wedding|second_hand_clothes)$")],
     ["clothing_store", "fashion_and_apparel_store", "fashion_boutique", "designer_clothing", "bridal_shop",
      "second_hand_clothing_store", "custom_t_shirt_store", "uniform_store", "baby_gear_and_nursery_store"]),

    # ---- Lebensmittel & Getränke
    ("baeckerei", "Bäckerei & Konditorei", "lebensmittel", 26,
     [("shop", "^(bakery|confectionery|chocolate)$")],
     ["bakery", "chocolatier", "candy_store"]),
    ("metzgerei", "Metzgerei, Feinkost & Fisch", "lebensmittel", 26,
     [("shop", "^(butcher|deli|cheese|seafood|spices)$")],
     ["butcher_shop", "delicatessen", "cheese_shop", "fishmonger", "specialty_foods_store", "herb_and_spice_store"]),
    ("getraenke", "Getränke, Wein & Brauerei", "lebensmittel", 28,
     [("shop", "^(beverages|wine|alcohol|brewing_supplies)$"), ("craft", "^(brewery|winery|distillery)$")],
     ["liquor_store", "beer_wine_spirits_store", "winery", "brewery", "distillery", "beverage_supplier", "wine_wholesaler"]),
    ("hofladen", "Hofladen, Bio & Wochenmarkt", "lebensmittel", 24,
     [("shop", "^(farm|organic|greengrocer|health_food|honey|dairy)$")],
     ["honey_farm_shop", "farm", "greengrocer", "produce_store", "organic_grocery_store", "health_food_store", "farmers_market", "dairy_store",
      "vitamin_and_supplement_store", "coffee_and_tea_supplies"]),
    ("kiosk", "Kiosk, Tabak & Lotto", "lebensmittel", 18,
     [("shop", "^(kiosk|tobacco|e-cigarette|lottery|newsagent)$")],
     ["kiosk", "tobacco_shop", "smoke_and_vape_store", "lottery_vendor", "newspaper_and_magazines_store"]),
    ("supermarkt", "Supermarkt & Lebensmittelmarkt", "lebensmittel", 20,
     [("shop", "^(supermarket|convenience)$")],
     ["grocery_store", "convenience_store", "discount_store", "warehouse_club_store", "asian_grocery_store",
      "food_and_beverage_store"]),

    # ---- Beauty & Wellness
    ("friseur", "Friseur & Barbershop", "beauty", 28,
     [("shop", "^(hairdresser|barber)$")],
     ["hair_salon", "barber", "hair_stylist"]),
    ("kosmetik", "Kosmetik, Nagel- & Sonnenstudio", "beauty", 28,
     [("shop", "^(beauty|nail_salon|tanning)$"), ("leisure", "^(tanning_salon)$")],
     ["beauty_salon", "nail_salon", "skin_care_and_makeup", "eyelash_service", "waxing", "hair_removal",
      "laser_hair_removal", "makeup_artist", "tanning_salon", "foot_care", "personal_or_beauty_service"]),
    ("wellness", "Massage, Spa & Sauna", "beauty", 28,
     [("shop", "^(massage)$"), ("leisure", "^(sauna)$"), ("amenity", "^(spa|public_bath)$")],
     ["massage_therapy", "spa", "day_spa", "health_spa", "medical_spa", "sauna", "public_bath_house", "wellness_service",
      "meditation_center", "weight_loss_center"]),
    ("tattoo", "Tattoo & Piercing", "beauty", 24,
     [("shop", "^(tattoo|piercing)$")],
     ["tattoo_and_piercing", "tattoo", "piercing"]),

    # ---- Fitness & Sport
    ("fitness", "Fitnessstudio, Yoga & Personal Training", "sport", 36,
     [("leisure", "^(fitness_centre)$"), ("amenity", "^(gym)$")],
     ["gym", "fitness_studio", "yoga_studio", "pilates_studio", "fitness_trainer"]),
    ("fahrrad", "Fahrrad & E-Bike", "sport", 32,
     [("shop", "^(bicycle)$")],
     ["bike_store", "bike_repair_maintenance", "bike_rental"]),
    ("sportgeschaeft", "Sportgeschäft & Outdoor", "sport", 32,
     [("shop", "^(sports|outdoor|ski|fishing|hunting|golf|scuba_diving)$")],
     ["sporting_goods_store", "sportswear_store", "outdoor_store", "hunting_and_fishing_store", "ski_and_snowboard_store",
      "fitness_exercise_store", "gun_and_ammo_store"]),
    ("sportanlage", "Sportanlage, Kletterhalle & Golf", "sport", 28,
     [("leisure", "^(sports_centre|sports_hall|golf_course|ice_rink|horse_riding|climbing)$")],
     ["sport_or_fitness_facility", "sports_complex", "golf_course", "horseback_riding_service", "horse_riding",
      "equestrian_facility", "horse_boarding", "gymnastics_center", "shooting_range", "skating_rink", "diving_center", "swimming_instructor"]),

    # ---- Elektronik & Technik
    ("handy", "Handy & Telekommunikation", "technik", 28,
     [("shop", "^(mobile_phone|telecommunication)$")],
     ["mobile_phone_store", "mobile_phone_repair", "telephone_service"]),
    ("computer", "Computer & IT-Service", "technik", 28,
     [("shop", "^(computer)$"), ("craft", "^(electronics_repair|computer_repair)$")],
     ["computer_store", "it_service_and_computer_repair", "electronics_repair_shop"]),
    ("elektronik", "Elektronik, Foto & HiFi", "technik", 30,
     [("shop", "^(electronics|hifi|video_games|camera|radiotechnics)$")],
     ["electronics_store", "audio_visual_equipment_store", "camera_and_photography_store", "car_stereo_store",
      "battery_store", "video_game_store"]),

    # ---- Weitere Händler
    ("blumen", "Blumen & Geschenke", "handel", 26,
     [("shop", "^(florist|gift|souvenir)$")],
     ["florist", "gift_shop", "flowers_and_gifts_store", "souvenir_store", "floral_designer"]),
    ("tier", "Tierbedarf & Tierservice", "handel", 24,
     [("shop", "^(pet|pet_grooming|animal_feed)$"), ("amenity", "^(animal_boarding|animal_training)$")],
     ["pet_store", "aquatic_pet_store", "pet_groomer", "dog_trainer", "pet_boarding", "pet_sitting", "dog_walker",
      "pet_care_service", "livestock_feed_and_supply_store", "pet_training", "pet_breeder", "animal_or_pet_service"]),
    ("hobby", "Spielwaren, Bücher & Hobby", "handel", 26,
     [("shop", "^(toys|books|stationery|art|craft|music|musical_instrument|model|games|fabric|sewing|frame|party|costume|anime)$")],
     ["toy_store", "bookstore", "books_music_and_video_store", "craft_store", "fabric_store", "hobby_shop",
      "arts_crafts_and_hobby_store", "musical_instrument_store", "office_supply_store", "music_and_dvd_store", "framing_store",
      "party_supply_store", "costume_store", "embroidery_and_crochet_store", "knitting_supply_store", "piano_store",
      "guitar_store", "toys_and_games_store"]),
    ("reisebuero", "Reisebüro & Reiseveranstalter", "handel", 28,
     [("shop", "^(travel_agency)$"), ("office", "^(travel_agent|tourism)$")],
     ["travel_agent", "tour_operator", "sightseeing_tour_agency", "vacation_rental_agent", "boat_tour", "travel_service"]),
    ("bestatter", "Bestatter", "handel", 24,
     [("shop", "^(funeral_directors)$")],
     ["funeral_service"]),
    ("foto", "Fotostudio, Druck & Werbetechnik", "handel", 26,
     [("shop", "^(photo|copyshop|printing)$"), ("craft", "^(photographer|printer|sign_maker|signmaker)$")],
     ["photography_service", "event_photography_service", "session_photography_service", "printing_service",
      "sign_making", "screen_printing_service", "t_shirt_printing_service", "3d_printing_service", "commercial_printer"]),
    ("handel_sonst", "Sonstiger Handel & Kaufhaus", "handel", 20,
     [("shop", "^(department_store|mall|variety_store|second_hand|charity|general|pawnbroker|outpost|wholesale|erotic|weapons)$")],
     ["department_store", "shopping_mall", "second_hand_store", "antique_store", "outlet_store", "pawn_shop", "flea_market",
      "shopping", "specialty_store", "pop_up_store", "auction_house", "adult_store", "fireworks_store",
      "safety_equipment_store", "junkyard"], True),

    # ---- Bau-, Garten- & Fachhandel
    ("baustoffe", "Baumarkt & Baustoffhandel", "baumarkt", 30,
     [("shop", "^(doityourself|hardware|trade|paint|building_materials|windows|doors|tool_hire)$")],
     ["building_supply_store", "home_improvement_store", "hardware_store", "do_it_yourself_store", "lumber_store",
      "paint_store", "electrical_supply_store", "welding_supply_store", "woodworking_supply_store",
      "hardware_home_and_garden_store", "machine_and_tool_rental"]),
    ("garten", "Gartencenter & Pool", "baumarkt", 28,
     [("shop", "^(garden_centre|garden_furniture|swimming_pool)$")],
     ["nursery_and_gardening_store", "lawn_mower_store", "hot_tub_and_pool_store"]),

    # ---- Immobilien
    ("bautraeger", "Bauträger & Fertighaus", "immobilien", 36,
     [("office", "^(property_developer|developer)$")],
     ["home_developer", "builder", "mobile_home_dealer"]),
    ("makler", "Immobilienmakler", "immobilien", 34,
     [("office", "^(estate_agent|real_estate_agent)$")],
     ["real_estate_agent", "apartment_agent", "commercial_real_estate", "real_estate_service"]),
    ("hausverwaltung", "Hausverwaltung", "immobilien", 26,
     [("office", "^(property_management)$")],
     ["property_management", "housing_cooperative"]),
    ("architekt", "Architekt, Vermessung & Statik", "immobilien", 28,
     [("office", "^(architect|surveyor)$")],
     ["architect", "architectural_designer", "land_surveying", "structural_engineer"]),

    # ---- Dienstleister & B2B
    ("personal", "Personal & Zeitarbeit", "dienst", 30,
     [("office", "^(employment_agency|recruiter)$")],
     ["employment_agency", "temp_agency", "b2b_human_resource_service", "talent_agency"]),
    ("it", "IT, Software & Internet", "dienst", 28,
     [("office", "^(it|telecommunication|software)$")],
     ["information_technology_company", "software_development", "it_consultant", "web_designer", "web_hosting_service",
      "internet_service_provider", "telecommunications_company", "telecommunications_service", "computer_hardware_company",
      "e_commerce_service", "computer_wholesaler"]),
    ("agentur", "Werbe-, Marketing- & Designagentur", "dienst", 20,
     [("office", "^(advertising_agency|marketing)$")],
     ["advertising_agency", "marketing_agency", "internet_marketing_service", "public_relations", "media_agency",
      "graphic_designer", "b2b_marketing_consultant", "b2b_promotional_products_and_services", "product_design",
      "b2b_advertising_and_marketing_service", "design_service"]),
    ("medien", "Medien, Verlag & Eventservice", "dienst", 26,
     [("office", "^(newspaper|publisher|event_management)$")],
     ["publisher", "media_service", "media_news_company", "video_film_production", "recording_and_rehearsal_studio",
      "event_technology_service", "party_and_event_planning", "wedding_planning", "dj_service", "event_or_party_service",
      "photo_booth_rental", "music_production", "radio_station", "print_media", "party_equipment_rental", "musician",
      "kids_recreation_and_party", "magician"]),
    ("logistik", "Logistik, Transport & Umzug", "dienst", 25,
     [("office", "^(logistics|moving_company|courier)$")],
     ["freight_and_cargo_service", "motor_freight_trucking", "distribution_service", "freight_forwarding_agency",
      "courier_and_delivery_service", "mover", "packing_service", "b2b_transportation_and_storage_service",
      "storage_facility", "self_storage_facility"]),
    ("reinigung", "Reinigung, Wäscherei & Sicherheitsdienst", "dienst", 24,
     [("shop", "^(dry_cleaning|laundry)$"), ("office", "^(cleaning|security)$")],
     ["cleaning_service", "janitorial_service", "office_cleaning", "home_cleaning", "carpet_cleaning", "laundry_service",
      "dry_cleaning", "laundromat", "security_service", "pressure_washing"]),
    ("ingenieur", "Ingenieurbüro & Labor", "dienst", 22,
     [("office", "^(engineer|engineering|research)$")],
     ["engineering_service", "mechanical_engineer", "civil_engineer", "laboratory", "automation_service", "home_inspector"]),
    ("industrie", "Industrie, Großhandel & Hersteller", "dienst", 26,
     [("office", "^(company|industrial)$"), ("industrial", ".")],
     ["manufacturer", "supplier_or_distributor", "wholesaler", "b2b_service", "industrial_company",
      "corporate_or_business_office", "metal_supplier", "plastics_company", "machine_shop", "import_export_service",
      "industrial_equipment_manufacturer", "machinery_and_tool_manufacturer", "electronic_equipment_supplier",
      "energy_company", "pharmaceutical_company", "biotechnology_company", "clothing_company", "auto_company"]),
    ("beratung", "Beratung, Büro- & Übersetzungsservice", "dienst", 25,
     [("office", "^(consulting|coworking|translator|notary_public_office)$"), ("amenity", "^(coworking_space)$")],
     ["business_consulting", "professional_service", "b2b_business_management_service", "translation_service",
      "translating_and_interpreting_service", "career_counseling", "coworking_space", "typing_service", "life_coach"]),

    # ---- Bildung
    ("kita", "Kita & Kindergarten", "bildung", 12,
     [("amenity", "^(kindergarten|childcare)$")],
     ["preschool", "child_care_and_day_care", "day_care_preschool"]),
    ("privatschule", "Privatschule & Internat", "bildung", 28,
     [("amenity", "^(school)$", PRIVATE)],
     ["private_school"]),
    ("schule", "Schule", "bildung", 10,
     [("amenity", "^(school)$")],
     ["school", "elementary_school", "high_school", "middle_school", "public_school"]),
    ("hochschule", "Hochschule & Universität", "bildung", 26,
     [("amenity", "^(university|college)$")],
     ["college_university"]),
    ("nachhilfe", "Nachhilfe & Lernstudio", "bildung", 30,
     [("amenity", "^(prep_school|tutoring)$")],
     ["tutoring_service"]),
    ("kursschule", "Sprach-, Musik-, Tanz- & Kunstschule", "bildung", 30,
     [("amenity", "^(language_school|music_school|dancing_school|art_school)$"), ("leisure", "^(dance)$")],
     ["language_school", "music_school", "art_school", "dance_studio", "vocal_coach", "cooking_school"]),
    ("weiterbildung", "Weiterbildung & Akademie", "bildung", 30,
     [("amenity", "^(training|adult_education)$"), ("office", "^(educational_institution)$")],
     ["adult_education_center", "vocational_and_technical_school", "educational_service", "specialty_school",
      "computer_coaching", "cosmetology_school", "childbirth_education", "education"]),

    # ---- Freizeit & Events
    ("erlebnis", "Freizeit & Erlebnis", "freizeit", 32,
     [("leisure", "^(bowling_alley|escape_game|amusement_arcade|trampoline_park|water_park|miniature_golf|adult_gaming_centre)$"),
      ("tourism", "^(theme_park|zoo)$"), ("amenity", "^(casino|gambling)$")],
     ["bowling_alley", "escape_room", "laser_tag", "miniature_golf_course", "amusement_park", "arcade", "casino",
      "betting_center", "pool_hall", "pool_billiards", "water_park", "zoo", "go_kart_club", "gaming_venue", "race_track"]),
    ("kultur", "Kino, Theater & Konzert", "freizeit", 28,
     [("amenity", "^(cinema|theatre|arts_centre|music_venue)$")],
     ["movie_theater", "theatre_venue", "performing_arts_venue", "music_venue", "comedy_club", "jazz_and_blues_venue"]),
    ("eventlocation", "Eventlocation & Messe", "freizeit", 30,
     [("amenity", "^(events_venue|conference_centre|exhibition_centre)$")],
     ["event_venue", "exhibition_and_trade_fair_venue", "festival_venue"]),

    # ---- Gesundheit & Pflege
    ("pflege", "Pflegedienst & Seniorenheim", "gesundheit", 26,
     [("amenity", "^(nursing_home)$"), ("healthcare", "^(nurse|home_care)$"), ("social_facility", "^(nursing_home|assisted_living)$")],
     ["nursing", "home_health_care", "assisted_living_facility", "retirement_home", "senior_living_facility", "hospice"]),
    ("apotheke", "Apotheke & Sanitätshaus", "gesundheit", 18,
     [("amenity", "^(pharmacy)$"), ("shop", "^(medical_supply|chemist|orthopedics)$")],
     ["pharmacy", "drugstore", "medical_supply_store", "dental_supply_store", "pharmacy_and_drug_store"]),
    ("therapie", "Physiotherapie, Heilpraktiker & Psychotherapie", "gesundheit", 18,
     [("healthcare", "^(physiotherapist|alternative|psychotherapist|speech_therapist|occupational_therapist|podiatrist)$")],
     ["physical_therapy", "complementary_and_alternative_medicine", "naturopathic_medicine", "osteopathic_medicine",
      "speech_therapy", "occupational_therapy", "psychotherapy", "psychology", "nutrition_service", "health_coaching",
      "chiropractic", "acupuncture", "homeopathy", "podiatry", "physical_medicine_and_rehabilitation", "counseling",
      "midwifery", "hypnotherapy"]),
    ("tierarzt", "Tierarzt", "gesundheit", 18,
     [("amenity", "^(veterinary)$")],
     ["veterinarian", "veterinary_care"]),
    ("arzt", "Arzt, Zahnarzt & Klinik", "gesundheit", 14,
     [("amenity", "^(doctors|dentist|clinic)$"), ("healthcare", "^(doctor|dentist|clinic)$")],
     ["doctors_office", "dental_clinic", "outpatient_care_facility", "specialized_health_care", "orthodontics",
      "family_practice", "pediatric_clinic", "dermatology", "cosmetic_dentistry", "plastic_and_reconstructive_surgery"]),

    # ---- Banken & Versicherungen
    ("versicherung", "Versicherung & Finanzberatung", "finanzen", 26,
     [("office", "^(insurance|financial|financial_advisor|tax)$")],
     ["insurance_agency", "financial_advising", "mortgage_broker", "investment_management_company", "investing",
      "life_insurance", "auto_insurance", "broker", "real_estate_investment", "health_insurance_office",
      "financial_service"]),
    ("bank", "Bank & Sparkasse", "finanzen", 22,
     [("amenity", "^(bank)$")],
     ["bank_or_credit_union", "bank", "credit_union"]),

    # ---- Recht & Steuern
    ("steuer", "Steuerberater & Buchhaltung", "recht", 12,
     [("office", "^(tax_advisor|accountant)$")],
     ["tax_service", "accountant", "bookkeeper"]),
    ("anwalt", "Rechtsanwalt & Notar", "recht", 12,
     [("office", "^(lawyer|notary)$")],
     ["attorney_or_law_firm", "notary_public", "legal_service", "mediator"]),
]

GROUP_NAMES = dict(GROUPS)
CATEGORIES = {}
for _row in _CATEGORIES:
    _cid, _name, _group, _weight, _osm, _ov = _row[:6]
    CATEGORIES[_cid] = {"id": _cid, "name": _name, "group": _group, "weight": _weight,
                        "filters": _osm, "ov": _ov, "fallback": len(_row) > 6 and _row[6]}

# Spezielle Branchen zuerst prüfen, Sammelbranchen zuletzt
_ORDER = [c for c in CATEGORIES.values() if not c["fallback"]] + [c for c in CATEGORIES.values() if c["fallback"]]
_OSM_RULES = [(c["id"], key, re.compile(pattern), extra[0] if extra else None)
              for c in _ORDER for key, pattern, *extra in c["filters"]]
_OV_MAP = {}
for _cat in _ORDER:
    for _key in _cat["ov"]:
        _OV_MAP.setdefault(_key, _cat["id"])


def _extra_ok(tags, extra):
    return all(tags.get(k) and re.search(p, tags[k]) for k, p in extra.items())


def classify(tags):
    """Ordnet OSM-Tags der ersten passenden Unterbranche zu (oder None)."""
    for cid, key, pattern, extra in _OSM_RULES:
        value = tags.get(key)
        if value and pattern.search(value) and (not extra or _extra_ok(tags, extra)):
            return cid
    return None


# Keine Werbekunden, auch wenn ein Oberbegriff passen würde
OV_EXCLUDE = {"atm", "recycling_center", "library", "educational_facility", "campus_building", "student_union",
              "university_housing", "package_locker", "post_office", "parking", "parking_garage", "parking_lot",
              "bike_parking", "ev_charging_station", "taxi_stand", "public_fountain", "playground", "swimming_pool",
              "sport_court", "sport_field", "stadium", "skate_park", "rock_climbing_spot", "park", "public_facility",
              "memorial_site", "research_institute", "choir", "band_orchestra_symphony", "visitor_center",
              "passport_and_visa_service", "shipping_center"}


def classify_overture(primary, hierarchy=()):
    """Overture-Kategorie (Blatt + Oberbegriffe) -> Unterbranche (oder None)."""
    if primary in OV_EXCLUDE or OV_EXCLUDE.intersection(hierarchy or ()):
        return None
    for key in [primary, *reversed(hierarchy or ())]:
        if key in _OV_MAP:
            return _OV_MAP[key]
    return None


_KITA = re.compile(r"kinderh[aä]us|\bkita\b|kindertages|kindergarten|kinderkrippe|\bkrippe\b|kinderbetreuung", re.I)


def fix_category(category, name):
    """Kinderhäuser/Kitas, die eine Quelle als Schule führt, als Kita einordnen."""
    if category in ("schule", "privatschule", "weiterbildung", "kursschule") and _KITA.search(name or ""):
        return "kita"
    return category


def operator_type(tags):
    """öffentlich / privat / kirchlich – nur wo OSM es angibt."""
    value = (tags.get("operator:type") or "").lower()
    return {"public": "öffentlich", "government": "öffentlich", "private": "privat", "religious": "kirchlich",
            "community": "gemeinnützig", "ngo": "gemeinnützig", "charitable": "gemeinnützig"}.get(value, "")


# ---- Deutsche Bezeichnungen für die Art des Betriebs ----------------------
KIND_DE = {
    # OSM
    "car": "Autohaus", "car_repair": "Kfz-Werkstatt", "tyres": "Reifenhandel", "car_parts": "Autoteile",
    "motorcycle": "Motorradhändler", "caravan": "Wohnmobile", "truck": "Lkw-Handel", "car_rental": "Autovermietung",
    "car_wash": "Waschanlage", "fuel": "Tankstelle", "furniture": "Möbelhaus", "kitchen": "Küchenstudio",
    "bathroom_furnishing": "Badausstellung", "interior_decoration": "Wohnaccessoires", "bed": "Betten",
    "lighting": "Leuchten", "appliance": "Haushaltsgeräte", "flooring": "Bodenbeläge", "tiles": "Fliesenhandel",
    "restaurant": "Restaurant", "cafe": "Café", "bar": "Bar", "pub": "Kneipe", "nightclub": "Club",
    "fast_food": "Imbiss", "biergarten": "Biergarten", "ice_cream": "Eisdiele", "hotel": "Hotel", "motel": "Motel",
    "guest_house": "Pension", "apartment": "Ferienwohnung", "hostel": "Hostel", "camp_site": "Campingplatz",
    "clothes": "Bekleidung", "boutique": "Boutique", "shoes": "Schuhe", "jewelry": "Schmuck", "watches": "Uhren",
    "optician": "Optiker", "hearing_aids": "Hörakustik", "perfumery": "Parfümerie", "cosmetics": "Kosmetikartikel",
    "bag": "Taschen", "bakery": "Bäckerei", "pastry": "Konditorei", "confectionery": "Süßwaren", "butcher": "Metzgerei",
    "deli": "Feinkost", "beverages": "Getränkemarkt", "wine": "Weinhandlung", "farm": "Hofladen", "organic": "Bioladen",
    "greengrocer": "Obst & Gemüse", "supermarket": "Supermarkt", "convenience": "Lebensmittel", "kiosk": "Kiosk",
    "tobacco": "Tabakwaren", "hairdresser": "Friseur", "barber": "Barbershop", "beauty": "Kosmetikstudio",
    "nail_salon": "Nagelstudio", "massage": "Massage", "tattoo": "Tattoo", "sauna": "Sauna",
    "fitness_centre": "Fitnessstudio", "sports_centre": "Sportzentrum", "sports": "Sportgeschäft",
    "bicycle": "Fahrradladen", "outdoor": "Outdoor", "electronics": "Elektronik", "mobile_phone": "Handyladen",
    "computer": "Computer", "hifi": "HiFi", "florist": "Blumen", "gift": "Geschenke", "pet": "Tierbedarf",
    "toys": "Spielwaren", "books": "Buchhandlung", "stationery": "Schreibwaren", "music": "Musik",
    "musical_instrument": "Musikinstrumente", "travel_agency": "Reisebüro", "funeral_directors": "Bestatter",
    "photo": "Fotostudio", "copyshop": "Copyshop", "department_store": "Kaufhaus", "mall": "Einkaufszentrum",
    "second_hand": "Second Hand", "doityourself": "Baumarkt", "hardware": "Eisenwaren", "trade": "Baustoffhandel",
    "paint": "Farben", "garden_centre": "Gartencenter", "estate_agent": "Immobilienmakler",
    "property_management": "Hausverwaltung", "architect": "Architekt", "construction_company": "Bauunternehmen",
    "it": "IT-Firma", "advertising_agency": "Werbeagentur", "consulting": "Beratung", "employment_agency": "Personalvermittlung",
    "logistics": "Logistik", "company": "Firma", "insurance": "Versicherung", "financial": "Finanzdienstleister",
    "financial_advisor": "Finanzberater", "bank": "Bank", "lawyer": "Rechtsanwalt", "notary": "Notar",
    "tax_advisor": "Steuerberater", "accountant": "Buchhaltung", "kindergarten": "Kindergarten", "childcare": "Kinderbetreuung",
    "school": "Schule", "university": "Universität", "college": "Hochschule", "prep_school": "Nachhilfe",
    "language_school": "Sprachschule", "music_school": "Musikschule", "dancing_school": "Tanzschule",
    "driving_school": "Fahrschule", "cinema": "Kino", "theatre": "Theater", "casino": "Spielbank",
    "bowling_alley": "Bowling", "escape_game": "Escape Room", "events_venue": "Eventlocation",
    "doctors": "Arztpraxis", "dentist": "Zahnarzt", "clinic": "Klinik", "pharmacy": "Apotheke",
    "physiotherapist": "Physiotherapie", "alternative": "Heilpraktiker", "veterinary": "Tierarzt",
    "nursing_home": "Pflegeheim", "medical_supply": "Sanitätshaus",
    "plumber": "Sanitär", "hvac": "Heizung & Klima", "heating_engineer": "Heizungsbau", "electrician": "Elektriker",
    "painter": "Maler", "plasterer": "Stuckateur", "roofer": "Dachdecker", "carpenter": "Zimmerei",
    "joiner": "Schreinerei", "cabinet_maker": "Schreinerei", "tiler": "Fliesenleger", "floorer": "Bodenleger",
    "stonemason": "Steinmetz", "window_construction": "Fensterbau", "metal_construction": "Metallbau",
    "glaziery": "Glaserei", "locksmith": "Schlüsseldienst", "gardener": "Gartenbau", "builder": "Bauunternehmen",
    "caterer": "Catering", "photographer": "Fotograf", "printer": "Druckerei", "upholsterer": "Raumausstatter",
    "tailor": "Schneiderei", "shoemaker": "Schuhmacher", "brewery": "Brauerei", "winery": "Weingut",
    "chimney_sweeper": "Schornsteinfeger", "electronics_repair": "Elektronik-Reparatur", "goldsmith": "Goldschmied",
    "scaffolder": "Gerüstbau", "insulation": "Dämmung",
    # Overture
    "plumbing": "Sanitär", "hvac_service": "Heizung & Klima", "bathroom_remodeling": "Badsanierung",
    "painting": "Maler", "roofing": "Dachdecker", "flooring_contractor": "Bodenleger", "tiling": "Fliesenleger",
    "contractor": "Handwerksbetrieb", "building_contractor": "Bauunternehmen", "automotive_repair": "Kfz-Werkstatt",
    "auto_dealer": "Autohaus", "used_auto_dealer": "Gebrauchtwagen", "tire_shop": "Reifenhandel",
    "auto_body_shop": "Karosserie & Lack", "hair_salon": "Friseur", "beauty_salon": "Kosmetikstudio",
    "massage_therapy": "Massage", "gym": "Fitnessstudio", "yoga_studio": "Yoga", "clothing_store": "Bekleidung",
    "womens_clothing_store": "Damenmode", "mens_clothing_store": "Herrenmode", "childrens_clothing_store": "Kindermode",
    "shoe_store": "Schuhe", "jewelry_store": "Schmuck", "eyewear_store": "Optiker", "furniture_store": "Möbelhaus",
    "bakery": "Bäckerei", "butcher_shop": "Metzgerei", "grocery_store": "Lebensmittel", "liquor_store": "Getränkemarkt",
    "german_restaurant": "Deutsche Küche", "italian_restaurant": "Italienisch", "pizza_restaurant": "Pizzeria",
    "greek_restaurant": "Griechisch", "turkish_restaurant": "Türkisch", "asian_restaurant": "Asiatisch",
    "chinese_restaurant": "Chinesisch", "indian_restaurant": "Indisch", "thai_restaurant": "Thailändisch",
    "vietnamese_restaurant": "Vietnamesisch", "sushi_restaurant": "Sushi", "japanese_restaurant": "Japanisch",
    "mexican_restaurant": "Mexikanisch", "spanish_restaurant": "Spanisch", "french_restaurant": "Französisch",
    "burger_restaurant": "Burger", "steakhouse": "Steakhouse", "doner_kebab_restaurant": "Döner",
    "vegan_restaurant": "Vegan", "vegetarian_restaurant": "Vegetarisch", "cafe": "Café", "coffee_shop": "Café",
    "ice_cream_shop": "Eisdiele", "real_estate_agent": "Immobilienmakler", "property_management": "Hausverwaltung",
    "insurance_agency": "Versicherungsagentur", "tax_service": "Steuerberatung", "attorney_or_law_firm": "Rechtsanwalt",
    "information_technology_company": "IT-Firma", "software_development": "Softwareentwicklung",
    "web_designer": "Webdesign", "advertising_agency": "Werbeagentur", "business_consulting": "Unternehmensberatung",
    "employment_agency": "Personalvermittlung", "temp_agency": "Zeitarbeit", "cleaning_service": "Reinigung",
    "photography_service": "Fotograf", "printing_service": "Druckerei", "florist": "Blumen", "pet_store": "Tierbedarf",
    "travel_agent": "Reisebüro", "funeral_service": "Bestatter", "physical_therapy": "Physiotherapie",
    "doctors_office": "Arztpraxis", "dental_clinic": "Zahnarzt", "pharmacy": "Apotheke", "nursing": "Pflegedienst",
    "retirement_home": "Seniorenheim", "preschool": "Kindergarten", "child_care_and_day_care": "Kinderbetreuung",
    "elementary_school": "Grundschule", "high_school": "Gymnasium", "private_school": "Privatschule",
    "college_university": "Hochschule", "tutoring_service": "Nachhilfe", "language_school": "Sprachschule",
    "music_school": "Musikschule", "dance_studio": "Tanzschule", "driving_school": "Fahrschule",
    "building_supply_store": "Baustoffhandel", "hardware_store": "Eisenwaren", "manufacturer": "Hersteller",
    "wholesaler": "Großhandel", "freight_and_cargo_service": "Spedition", "electrician": "Elektriker",
    "carpenter": "Schreinerei/Zimmerei", "gardener": "Gartenbau", "landscaping": "Garten- & Landschaftsbau",
    "winery": "Weingut", "brewery": "Brauerei", "hotel": "Hotel", "bed_and_breakfast": "Pension",
    "holiday_rental_home": "Ferienwohnung", "guest_house": "Gästehaus",
}

CUISINE_DE = {
    "italian": "Italienisch", "pizza": "Pizzeria", "german": "Deutsche Küche", "regional": "Regionale Küche",
    "greek": "Griechisch", "turkish": "Türkisch", "kebab": "Döner", "asian": "Asiatisch", "chinese": "Chinesisch",
    "vietnamese": "Vietnamesisch", "thai": "Thailändisch", "indian": "Indisch", "japanese": "Japanisch",
    "sushi": "Sushi", "burger": "Burger", "steak_house": "Steakhouse", "mexican": "Mexikanisch", "spanish": "Spanisch",
    "french": "Französisch", "croatian": "Kroatisch", "balkan": "Balkan", "american": "Amerikanisch",
    "vegan": "Vegan", "vegetarian": "Vegetarisch", "swabian": "Schwäbisch", "coffee_shop": "Café", "cake": "Kuchen",
}


def osm_kind(tags):
    """Kurze deutsche Bezeichnung, z. B. 'Italienisch' oder 'Dachdecker'."""
    cuisine = (tags.get("cuisine") or "").split(";")[0].strip()
    if cuisine in CUISINE_DE:
        return CUISINE_DE[cuisine]
    for key in ("craft", "shop", "amenity", "office", "healthcare", "leisure", "tourism"):
        if tags.get(key) in KIND_DE:
            return KIND_DE[tags[key]]
    return ""


def overture_kind(primary):
    return KIND_DE.get(primary, "")
