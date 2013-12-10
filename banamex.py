#
# Structure
#
# + Municipalities
#
# Text response, arbitrary separators.
# Equal sign marks two sections, only use the second one. Double pipes (||)
# mark end of records. Single pipes (|) mark end of fields.
#
# + ATMs
#
# Text response, arbitrary separators.
# Carets (^) mark end of records. Pipes (|) mark end of fields.
# Field index listed below:
#
# 0. ?
# 1. name
# 2. state
# 3. ?
# 4. municipality
# 5. ?
# 6. address
# 7. number
# 8. neighborhood
# 9. zipCode
# 10. reference street (1)
# 11. reference street (2)
# 12. ?
# 13. ?
# 14. ?
# 15. ?
# 16. ?
# 17. ?
# 18. ?
# 19. ?
# 20. ?
# 21. longitude
# 22. latitude
#

import requests
import time
import json
import os
import sys

# states = {
#   'distrito-federal': {
#     'id': 9,
#     'municipalities': (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)
#   }
# }

states = {
  'aguascalientes': {
    'id': 1
  },
  'baja-california': {
    'id': 2
  },
  'baja-california-sur': {
    'id': 3
  },
  'campeche': {
    'id': 4
  },
  'chiapas': {
    'id': 7
  },
  'chihuahua': {
    'id': 8
  },
  'coahuila': {
    'id': 5
  },
  'colima': {
    'id': 6
  },
  'distrito-federal': {
    'id': 9
  },
  'durango': {
    'id': 10
  },
  'estado-de-mexico': {
    'id': 15
  },
  'guanajuato': {
    'id': 11
  },
  'guerrero': {
    'id': 12
  },
  'hidalgo': {
    'id': 13
  },
  'jalisco': {
    'id': 14
  },
  'michoacan': {
    'id': 16
  },
  'morelos': {
    'id': 17
  },
  'nayarit': {
    'id': 18
  },
  'nuevo-leon': {
    'id': 19
  },
  'oaxaca': {
    'id': 20
  },
  'puebla': {
    'id': 21
  },
  'queretaro': {
    'id': 22
  },
  'quintana-roo': {
    'id': 23
  },
  'san-luis-potosi': {
    'id': 24
  },
  'sinaloa': {
    'id': 25
  },
  'sonora': {
    'id': 26
  },
  'tabasco': {
    'id': 27
  },
  'tamaulipas': {
    'id': 28
  },
  'tlaxcala': {
    'id': 29
  },
  'veracruz': {
    'id': 30
  },
  'yucatan': {
    'id': 31
  },
  'zacatecas': {
    'id': 32
  }
}

def get_municipalities_url(params):
  url = u'http://portal.banamex.com.mx/c719_050/mapasAction.do?opcion=llenaCombos&id_estado={stateId}'

  return url.format(stateId = params['stateId'])

def get_branches_url(params):
  url = u'http://portal.banamex.com.mx/c719_050/mapasAction.do?opcion=buscar&accion=cajero-&tipoBus=300&idioma=esp&estado={stateId}&iddel={municipalityId}'

  return url.format(stateId = params['stateId'], municipalityId = params['municipalityId'])

def get_state_info(state):
  geojson = {
    'type': 'FeatureCollection',
    'features': []
  }

  # Retrieving municipalities
  print 'Retrieving municipalities: ' + state + '...'

  url = get_municipalities_url({'stateId': states[state]['id']})
  request = requests.get(url)

  sections = request.text.split('=')
  records = sections[1].split('||')

  states[state]['municipalities'] = []

  for record in records:
    fields = record.split('|')
    states[state]['municipalities'].append(fields[0])

  # Extracting ATM info
  print 'Extracting ATM info: ' + state + '...'    

  try:
    os.makedirs('mx/' + state)
    os.makedirs('mx/' + state + '/raw')
  except OSError:
    pass

  for municipalityId in states[state]['municipalities']:
    print municipalityId

    url = get_branches_url({'stateId': states[state]['id'],  'municipalityId': municipalityId })
    request = requests.get(url)

    raw_data = open('mx/' + state + '/raw/banamex-' + str(municipalityId) + '.raw', 'w')
    raw_data.write(request.text.encode('utf8'))

    if request.text.strip() != 'No':
      rows = request.text.split('^')

      for row in rows:
        fields = row.split('|')

        name = fields[1].replace(', DF', '').replace(',DF', '').replace(' D.F.', '').replace(' D F', '').replace(' D F', '')

        branch = {
          'type': 'Feature',
          'geometry': {
            'type': 'Point',
            'coordinates': [fields[21], fields[22]]
          },
          'properties': {
            'bank': 'Banamex',
            'state': state.replace('-', ' ').title(),
            'municipality': fields[4].title(),
            'name': name.title(),
            'address': fields[6].title() + ' ' + fields[7].title(),
            'neighborhood': fields[8].title(),
            'zipCode': fields[9],
            'phone': None,
            'openingHours': None
          }
        }

        geojson['features'].append(branch)

    time.sleep(5)

  geodata = open('mx/' + state + '/banamex.geojson', 'w')
  json.dump(geojson, geodata, indent = 2, separators = (',', ': '))

if __name__ == '__main__':
  if(len(sys.argv) == 1):
    for state in states:
      get_state_info(state)

  else:
    if sys.argv[1] in states:
      get_state_info(sys.argv[1])
